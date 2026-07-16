#!/usr/bin/env node
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { cacheDir } = require('../../src/config')
const logger = require('../../src/logger')

function killSubscriber(sessionId) {
  const pidFile = path.join(cacheDir(), `${sessionId}.pid`)
  if (!fs.existsSync(pidFile))
    return
  try {
    const pid = Number.parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10)
    if (!Number.isNaN(pid))
      process.kill(pid, 'SIGTERM')
  }
  catch {}
  try { fs.unlinkSync(pidFile) }
  catch {}
}

async function handleStop(input) {
  const { post } = require('../../src/a2a-client')
  const { getStableContext } = require('../../src/git-context')

  const sessionId = input.session_id || ''
  if (!sessionId)
    return

  logger.log('[octowiz - stop] session ending', sessionId)

  killSubscriber(sessionId)

  // Release the machine-local runtime lease. Durable engineering state is
  // deliberately untouched: a session ending never marks work complete.
  // Spawn-free like start.js: identity from the state file, else the
  // directory name — the same derivation registration used.
  try {
    const runtime = require('../../src/state/runtime')
    const store = require('../../src/state/store')
    const cwd = input.cwd || process.cwd()
    const repositoryId = store.exists(cwd)
      ? store.read(cwd).repository.id
      : `local:${path.basename(path.resolve(cwd))}`
    runtime.releaseSession(repositoryId, sessionId)
  }
  catch (error) {
    logger.warn('[octowiz - stop] runtime lease release failed:', error?.message ?? error)
  }

  const ctx = getStableContext(sessionId)

  // Notify AELLI — advisory history, telemetry, and MemPalace session-end cleanup
  await post(
    'session-end',
    { sessionId, repo: ctx?.repo, repoRoot: ctx?.repoRoot },
    { sync: true, timeoutMs: 500 },
  ).catch(() => {})
}

if (require.main === module) {
  let raw = ''
  process.stdin.on('data', c => (raw += c))
  process.stdin.on('end', async () => {
    let input = {}
    try { input = JSON.parse(raw) }
    catch {}
    try { await handleStop(input) }
    catch {}
    process.exit(0)
  })
}

module.exports = { handleStop }
