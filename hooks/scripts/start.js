#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const config = require('../../src/config')
const logger = require('../../src/logger')

function appendLog(message) {
  try {
    fs.mkdirSync(config.cacheDir(), { recursive: true })
    fs.appendFileSync(config.logFile(), `[${new Date().toISOString()}] ${message}\n`)
  }
  catch {}
}

// Engineering-state integration, fail-open: a session start loads durable
// state for visibility and registers a machine-local runtime lease. It never
// mutates phase or state — sessions observing a repository is not progress.
// The hook stays process-spawn-free: the repository identity comes from the
// state file when one exists, and from the directory name otherwise (git
// derivation would spawn a process, which session hooks must never do).
function attachEngineeringState(sessionId, cwd) {
  try {
    const path = require('node:path')
    const runtime = require('../../src/state/runtime')
    const store = require('../../src/state/store')

    let repositoryId = `local:${path.basename(path.resolve(cwd))}`
    if (store.exists(cwd)) {
      const doc = store.read(cwd)
      repositoryId = doc.repository.id
      logger.log(`[octowiz - start] engineering state: ${doc.state} (phase ${doc.phase}, revision ${doc.revision})`)
    }
    runtime.registerSession(repositoryId, { sessionId, repositoryRoot: cwd })
  }
  catch (error) {
    logger.warn('[octowiz - start] engineering state unavailable:', error?.message ?? error)
    appendLog(`[octowiz - start] engineering state unavailable: ${error?.message ?? error}`)
  }
}

// Enforced doctrine mode: when the repository (or OCTOWIZ_ENFORCE) turns it
// on, SessionStart stdout injects the mandate into the session context so
// Octowiz is present in EVERY session, not only when the skill happens to
// fire. Fail-open and spawn-free like the rest of this hook.
function injectEnforcedMandate(cwd) {
  try {
    const enforce = require('../../src/state/enforce')
    if (!enforce.isEnforced(cwd))
      return
    const store = require('../../src/state/store')
    let stateLine = 'no engineering state — run `octowiz state init` before any engineering work'
    if (store.exists(cwd)) {
      const doc = store.read(cwd)
      stateLine = `${doc.state} (phase ${doc.phase}, revision ${doc.revision}) — goal: ${String(doc.goal || 'none').slice(0, 140)}`
    }
    process.stdout.write([
      '<octowiz-enforced>',
      'Octowiz enforced doctrine mode is ON for this repository.',
      `Engineering state: ${stateLine}`,
      'Mandate: before any engineering action, invoke the `octowiz` skill (lifecycle routing over this state) and apply the `octowiz-engineering-doctrine` completion gate. End the session with evidence recorded and the matching state transition — the Stop gate blocks sessions whose commits no state update accounts for. Toggle: `octowiz enforce off`.',
      '</octowiz-enforced>',
      '',
    ].join('\n'))
  }
  catch (error) {
    logger.warn('[octowiz - start] enforce mandate unavailable:', error?.message ?? error)
  }
}

async function handleStart(input) {
  const { post } = require('../../src/a2a-client')
  const { captureContext, getLiveContext } = require('../../src/git-context')

  const sessionId = input.session_id || `cc-${Date.now()}-${process.pid}`
  const cwd = input.cwd || process.cwd()

  logger.log('[octowiz - start] session starting', sessionId)

  attachEngineeringState(sessionId, cwd)
  injectEnforcedMandate(cwd)

  if (!config.authToken()) {
    logger.warn('[octowiz - start] AELLI_AUTH_TOKEN not set — advisory delivery disabled')
    appendLog('[octowiz - start] AELLI_AUTH_TOKEN not set — advisory delivery disabled')
  }

  const context = captureContext(sessionId, cwd)
  const payload = { ...context, ...getLiveContext(sessionId) }
  await post('session-start', payload, { sync: true, timeoutMs: 500 }).catch((error) => {
    logger.error('[octowiz - start] session-start post failed:', error?.message ?? error)
    appendLog(`[octowiz - start] session-start post failed: ${error?.message ?? error}`)
  })
}

if (require.main === module) {
  let raw = ''
  process.stdin.on('data', chunk => (raw += chunk))
  process.stdin.on('end', async () => {
    let input = {}
    try { input = JSON.parse(raw) }
    catch {}
    try { await handleStart(input) }
    catch (error) {
      logger.error('[octowiz - start] error:', error.message)
      appendLog(`[start] error: ${error.message}`)
    }
    process.exit(0)
  })
}

module.exports = { handleStart }
