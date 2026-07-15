'use strict'

const { spawn } = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')

const { version } = require('../../package.json')

function positiveNumber(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || path.join(__dirname, '../..')
const host = '127.0.0.1'
const port = positiveNumber(process.env.OCTOWIZ_LOCAL_PORT, 8764)
const a2aPort = positiveNumber(process.env.OCTOWIZ_A2A_PORT, 8765)
const idleMs = positiveNumber(process.env.OCTOWIZ_IDLE_TIMEOUT_MS, 600000)
const leaseTtlMs = positiveNumber(process.env.OCTOWIZ_LEASE_TTL_MS, 1800000)
const cacheDir = process.env.AELLI_CACHE_DIR || path.join(os.homedir(), '.cache', 'aelli-cc')
const pidFile = path.join(cacheDir, 'local-supervisor.pid')
const logFile = path.join(cacheDir, 'octowiz-local.log')

const sessions = new Map()
let idleTimer = null
let leaseSweep = null
let pythonChild = null
let server = null

function log(message) {
  fs.mkdirSync(cacheDir, { recursive: true })
  fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${message}\n`)
}

function isPortOpen(checkPort) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port: checkPort })
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('error', () => resolve(false))
  })
}

async function startPythonA2A() {
  if (await isPortOpen(a2aPort)) {
    log(`A2A port ${a2aPort} already in use; leaving existing service untouched`)
    return
  }

  const cwd = path.join(pluginRoot, 'apps', 'a2a-agent')
  if (!fs.existsSync(path.join(cwd, 'main.py'))) {
    log('Python A2A app missing; continuing without it')
    return
  }

  pythonChild = spawn('python3', ['-m', 'uvicorn', 'main:app', '--host', host, '--port', String(a2aPort)], {
    cwd,
    env: { ...process.env },
    stdio: 'ignore',
  })
  pythonChild.once('exit', (code, signal) => {
    log(`Python A2A exited code=${code ?? 'null'} signal=${signal ?? 'null'}`)
    pythonChild = null
  })
  log(`Python A2A started pid=${pythonChild.pid} port=${a2aPort}`)
}

function scheduleIdleExit() {
  if (idleTimer)
    clearTimeout(idleTimer)
  if (sessions.size > 0)
    return
  idleTimer = setTimeout(() => {
    log(`idle for ${idleMs}ms; shutting down`)
    shutdown(0)
  }, idleMs)
  idleTimer.unref()
}

function addLease(sessionId, cwd) {
  sessions.set(sessionId, { cwd, touchedAt: Date.now() })
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
  log(`lease added session=${sessionId} active=${sessions.size}`)
}

function releaseLease(sessionId) {
  sessions.delete(sessionId)
  log(`lease released session=${sessionId} active=${sessions.size}`)
  scheduleIdleExit()
}

function sweepExpiredLeases() {
  const now = Date.now()
  for (const [sessionId, lease] of sessions.entries()) {
    if (now - lease.touchedAt > leaseTtlMs) {
      sessions.delete(sessionId)
      log(`lease expired session=${sessionId} active=${sessions.size}`)
    }
  }
  scheduleIdleExit()
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

function readJson(req) {
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', chunk => (raw += chunk))
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}) }
      catch { resolve({}) }
    })
  })
}

function shutdown(code) {
  if (idleTimer)
    clearTimeout(idleTimer)
  if (leaseSweep)
    clearInterval(leaseSweep)
  if (server)
    server.close()
  if (pythonChild && !pythonChild.killed)
    pythonChild.kill('SIGTERM')
  try { fs.unlinkSync(pidFile) }
  catch {}
  process.exit(code)
}

async function main() {
  fs.mkdirSync(cacheDir, { recursive: true })
  fs.writeFileSync(pidFile, String(process.pid))

  await startPythonA2A()
  require('../../src/daemon').start()

  server = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      sendJson(res, 200, {
        status: 'ok',
        name: 'octowiz-local',
        version,
        pid: process.pid,
        sessions: sessions.size,
        mode: 'ephemeral',
      })
      return
    }

    if (req.method === 'POST' && req.url === '/lease') {
      const body = await readJson(req)
      if (!body.sessionId) {
        sendJson(res, 400, { error: 'sessionId required' })
        return
      }
      addLease(String(body.sessionId), String(body.cwd || ''))
      sendJson(res, 200, { status: 'leased', sessions: sessions.size })
      return
    }

    if (req.method === 'POST' && req.url === '/release') {
      const body = await readJson(req)
      if (body.sessionId)
        releaseLease(String(body.sessionId))
      sendJson(res, 200, { status: 'released', sessions: sessions.size })
      return
    }

    sendJson(res, 404, { error: 'not found' })
  })

  server.once('error', (error) => {
    log(`listen failed: ${error.message}`)
    shutdown(1)
  })

  server.listen(port, host, () => {
    log(`local supervisor ready version=${version} pid=${process.pid} port=${port}`)
    scheduleIdleExit()
  })

  leaseSweep = setInterval(sweepExpiredLeases, Math.min(leaseTtlMs, 60000))
  leaseSweep.unref()

  process.once('SIGTERM', () => shutdown(0))
  process.once('SIGINT', () => shutdown(0))
}

main().catch((error) => {
  log(`fatal: ${error.stack || error.message}`)
  shutdown(1)
})
