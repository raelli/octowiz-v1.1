'use strict'

const { spawn } = require('node:child_process')
const http = require('node:http')
const path = require('node:path')

const { version } = require('../../package.json')

const host = '127.0.0.1'
const port = Number(process.env.OCTOWIZ_LOCAL_PORT || 8764)
const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || path.join(__dirname, '../..')

function request(method, pathname, body, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : ''
    const req = http.request({
      host,
      port,
      method,
      path: pathname,
      timeout: timeoutMs,
      headers: payload
        ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }
        : {},
    }, (res) => {
      let raw = ''
      res.on('data', chunk => (raw += chunk))
      res.once('end', () => {
        let parsed = null
        try { parsed = raw ? JSON.parse(raw) : null }
        catch {}
        resolve({ status: res.statusCode || 0, body: parsed })
      })
    })
    req.once('timeout', () => req.destroy(new Error('timeout')))
    req.once('error', reject)
    if (payload)
      req.write(payload)
    req.end()
  })
}

async function health() {
  try { return await request('GET', '/health') }
  catch { return null }
}

function processBelongsToOctowiz(pid) {
  if (!Number.isInteger(pid) || pid <= 0)
    return false
  try {
    const { execFileSync } = require('node:child_process')
    const command = execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' })
    return command.includes('local-supervisor.js')
  }
  catch {
    return false
  }
}

async function ensureSupervisor() {
  const current = await health()
  if (current?.status === 200 && current.body?.name === 'octowiz-local') {
    if (current.body.version === version)
      return
    if (processBelongsToOctowiz(Number(current.body.pid))) {
      process.kill(Number(current.body.pid), 'SIGTERM')
      await new Promise(resolve => setTimeout(resolve, 250))
    }
    else {
      throw new Error('stale Octowiz supervisor could not be verified; refusing to stop it')
    }
  }
  else if (current) {
    throw new Error(`port ${port} is occupied by a non-Octowiz service`)
  }

  const child = spawn(process.execPath, [path.join(pluginRoot, 'hooks', 'scripts', 'local-supervisor.js')], {
    cwd: pluginRoot,
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot },
    detached: true,
    stdio: 'ignore',
  })
  child.unref()

  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 150))
    const state = await health()
    if (state?.status === 200 && state.body?.name === 'octowiz-local' && state.body.version === version)
      return
  }
  throw new Error('Octowiz local supervisor did not become healthy')
}

async function main() {
  let raw = ''
  process.stdin.on('data', chunk => (raw += chunk))
  process.stdin.on('end', async () => {
    let input = {}
    try { input = JSON.parse(raw) }
    catch {}

    const action = process.argv[2] || 'ensure'
    const sessionId = input.session_id || input.sessionId || `cc-${process.pid}`
    const cwd = input.cwd || process.cwd()

    try {
      if (action === 'release') {
        const state = await health()
        if (state?.status === 200 && state.body?.name === 'octowiz-local') {
          await request('POST', '/release', { sessionId })
        }
      }
      else {
        await ensureSupervisor()
        await request('POST', '/lease', { sessionId, cwd })
      }
    }
    catch (error) {
      console.error(`[octowiz local] ${error.message}`)
    }
    process.exit(0)
  })
}

main()
