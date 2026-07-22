#!/usr/bin/env node
'use strict'

// Stop-gate for enforced doctrine mode. Fires on the Claude Code `Stop`
// event: when enforcement is on and the session created commits that no
// engineering-state update accounts for, the stop is blocked once (exit 2,
// reason on stderr) so the agent records evidence and the transition first.
// `stop_hook_active` input means the agent already continued past a block —
// then the gate always yields to avoid loops. Every failure path is
// fail-open: enforcement must never brick a session on infrastructure.
//
// Spawn-free like start.js/stop.js: git facts come from reading `.git`
// files, session start time from the machine-local runtime lease.

const path = require('node:path')

function decide(input) {
  const enforce = require('../../src/state/enforce')
  const runtime = require('../../src/state/runtime')
  const store = require('../../src/state/store')

  const cwd = input.cwd || process.cwd()
  if (!enforce.isEnforced(cwd))
    return { block: false }

  const stateExists = store.exists(cwd)
  let doc = null
  if (stateExists)
    doc = store.read(cwd)

  // The lease was registered at session start under the identity known THEN.
  // `octowiz state init` mid-session can change the repository ID (remote
  // derivation), so fall back to the startup identity — otherwise every
  // commit after init would bypass the gate on a missing lease.
  const localId = `local:${path.basename(path.resolve(cwd))}`
  const candidateIds = doc ? [doc.repository.id, localId] : [localId]
  let lease = null
  for (const id of candidateIds) {
    lease = runtime.readRuntime(id).sessions.find(s => s.sessionId === input.session_id)
    if (lease)
      break
  }
  if (!lease || !lease.startedAt)
    return { block: false } // no lease under any identity — fail open

  const activity = enforce.commitActivitySince(cwd, lease.startedAt)
  // The state update must postdate the LAST commit: a state touch early in
  // the session does not account for commits made after it.
  const stateUpdatedAfterLastCommit = !!doc
    && new Date(doc.updatedAt).getTime() >= activity.lastEpochMs

  return enforce.decideStopGate({
    enforced: true,
    stopHookActive: input.stop_hook_active === true,
    stateExists,
    commitsThisSession: activity.count,
    stateUpdatedAfterLastCommit,
  })
}

if (require.main === module) {
  let raw = ''
  process.stdin.on('data', chunk => (raw += chunk))
  process.stdin.on('end', () => {
    let verdict = { block: false }
    try {
      let input = {}
      try { input = JSON.parse(raw) }
      catch {}
      verdict = decide(input)
    }
    catch {
      verdict = { block: false }
    }
    if (verdict.block) {
      console.error(verdict.reason)
      process.exit(2)
    }
    process.exit(0)
  })
}

module.exports = { decide }
