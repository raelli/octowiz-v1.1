'use strict'

const { spawn } = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')

const { version } = require('../../package.json')
const { checkStartup } = require('../../src/policy')

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
// 'started' | 'reused-current' | 'stale' | 'foreign' | 'missing' | 'unknown'
let a2aState = 'unknown'

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

// Classifies whatever is listening on the A2A port via its unauthenticated
// GET /health, which a current octowiz A2A answers with the plugin version.
async function classifyExistingA2A() {
  const body = await new Promise((resolve) => {
    const req = http.get({ host, port: a2aPort, path: '/health', timeout: 1500 }, (res) => {
      let raw = ''
      res.on('data', chunk => (raw += chunk))
      res.once('end', () => {
        try { resolve(JSON.parse(raw)) }
        catch { resolve(null) }
      })
    })
    req.once('timeout', () => req.destroy(new Error('timeout')))
    req.once('error', () => resolve(null))
  })

  if (body?.status === 'ok' && typeof body.version === 'string')
    return body.version === version ? { state: 'reused-current' } : { state: 'stale', version: body.version }
  return { state: 'foreign' }
}

async function startPythonA2A() {
  if (await isPortOpen(a2aPort)) {
    // Never stop a process we did not start — but never forward to one that
    // is not a current octowiz A2A either (stale versions silently break
    // changed or newly added capabilities).
    const existing = await classifyExistingA2A()
    if (existing.state === 'reused-current') {
      log(`A2A port ${a2aPort} already serves the current octowiz A2A (v${version}); reusing it`)
    }
    else if (existing.state === 'stale') {
      log(`A2A port ${a2aPort} is bound to a stale octowiz A2A (v${existing.version}, current is v${version}); `
        + 'not forwarding to it — stop the old process and restart a session to upgrade')
    }
    else {
      log(`A2A port ${a2aPort} is occupied by a non-Octowiz service; leaving it untouched and not forwarding to it`)
    }
    return existing.state
  }

  const cwd = path.join(pluginRoot, 'apps', 'a2a-agent')
  if (!fs.existsSync(path.join(cwd, 'main.py'))) {
    log('Python A2A app missing; continuing without it')
    return 'missing'
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
  return 'started'
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

  // Daemon policy is validated before anything is written or spawned, so a
  // misconfigured environment fails fast with nothing to clean up. The
  // supervisor runs detached (stdio ignored), so mirror the fatal reason into
  // the log file before checkStartup() exits the process.
  if (!(process.env.OCTOWIZ_ALLOWED_ROOTS || '').split(path.delimiter).some(root => root.trim()))
    log('fatal: OCTOWIZ_ALLOWED_ROOTS is not set or empty; daemon policy forbids startup')
  checkStartup()

  fs.writeFileSync(pidFile, String(process.pid))

  a2aState = await startPythonA2A()
  if (a2aState === 'stale' || a2aState === 'foreign') {
    log('daemon not started: the A2A endpoint is not a current octowiz service, so tasks will not be forwarded to it')
  }
  else {
    try {
      require('../../src/daemon').start()
    }
    catch (error) {
      // Boot failures after the Python child exists must release it.
      log(`daemon start failed: ${error.message}`)
      shutdown(1)
    }
  }

  server = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      sendJson(res, 200, {
        status: 'ok',
        name: 'octowiz-local',
        version,
        pid: process.pid,
        sessions: sessions.size,
        mode: 'ephemeral',
        a2a: a2aState,
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
