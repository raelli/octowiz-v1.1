'use strict'

const { spawn } = require('node:child_process')
const http = require('node:http')
const path = require('node:path')

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
      res.resume()
      res.once('end', () => resolve(res.statusCode || 0))
    })
    req.once('timeout', () => req.destroy(new Error('timeout')))
    req.once('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

async function healthy() {
  try { return await request('GET', '/health') === 200 }
  catch { return false }
}

async function ensureSupervisor() {
  if (await healthy()) return

  const child = spawn(process.execPath, [path.join(pluginRoot, 'hooks', 'scripts', 'local-supervisor.js')], {
    cwd: pluginRoot,
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot },
    detached: true,
    stdio: 'ignore',
  })
  child.unref()

  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 150))
    if (await healthy()) return
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
        if (await healthy()) await request('POST', '/release', { sessionId })
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
