'use strict'

// Enforced doctrine mode. When a repository toggles enforcement on, every
// session is REQUIRED to run under Octowiz routing: the SessionStart hook
// injects the mandate into context, and the Stop gate blocks a session from
// ending with commits that no state update accounts for. The toggle is
// repository-local (`.octowiz/config.json`) so it travels with the repo;
// `OCTOWIZ_ENFORCE` overrides it per environment (1/true/on, 0/false/off).
//
// Everything here is spawn-free: session hooks must never start processes,
// so git facts come from reading `.git` files directly.

const fs = require('node:fs')
const path = require('node:path')

const CONFIG_FILENAME = 'config.json'

function configFile(cwd) {
  return path.join(path.resolve(cwd), '.octowiz', CONFIG_FILENAME)
}

/** Repository-local octowiz config; empty object when absent or broken. */
function readConfig(cwd) {
  try {
    const doc = JSON.parse(fs.readFileSync(configFile(cwd), 'utf8'))
    return doc && typeof doc === 'object' && !Array.isArray(doc) ? doc : {}
  }
  catch {
    return {}
  }
}

/**
 * Is enforced doctrine mode active for this repository?
 * Precedence: OCTOWIZ_ENFORCE env (explicit on/off) > .octowiz/config.json.
 */
function isEnforced(cwd, env = process.env) {
  const raw = String(env.OCTOWIZ_ENFORCE ?? '').trim().toLowerCase()
  if (['1', 'true', 'on'].includes(raw))
    return true
  if (['0', 'false', 'off'].includes(raw))
    return false
  return readConfig(cwd).enforceDoctrine === true
}

/** Persist the toggle, preserving unrelated config keys. */
function setEnforced(cwd, value, now = new Date().toISOString()) {
  const file = configFile(cwd)
  const doc = readConfig(cwd)
  doc.enforceDoctrine = value === true
  doc.enforceDoctrineUpdatedAt = now
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}`
  fs.writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`)
  fs.renameSync(tmp, file)
  return doc
}

/** Resolve the real git dir, following worktree `gitdir:` redirect files. */
function resolveGitDir(cwd) {
  const dotGit = path.join(path.resolve(cwd), '.git')
  try {
    const stat = fs.statSync(dotGit)
    if (stat.isDirectory())
      return dotGit
    const content = fs.readFileSync(dotGit, 'utf8')
    const m = content.match(/^gitdir:(.*)$/m)
    if (m)
      return path.resolve(path.dirname(dotGit), m[1].trim())
  }
  catch {}
  return null
}

/**
 * Spawn-free commit detector: parses the reflog (`logs/HEAD`) for entries
 * whose action is a commit and whose timestamp is at or after `sinceIso`.
 * Checkouts, resets, and merges into the session do not count as work.
 */
function commitActivitySince(cwd, sinceIso) {
  const none = { count: 0, lastEpochMs: 0 }
  const gitDir = resolveGitDir(cwd)
  if (!gitDir)
    return none
  let raw
  try {
    raw = fs.readFileSync(path.join(gitDir, 'logs', 'HEAD'), 'utf8')
  }
  catch {
    return none
  }
  const sinceEpoch = Math.floor(new Date(sinceIso).getTime() / 1000)
  if (!Number.isFinite(sinceEpoch))
    return none
  let count = 0
  let lastEpochMs = 0
  for (const line of raw.split('\n')) {
    // <old-sha> <new-sha> <author> <epoch> <tz>\t<action>: <message>
    const m = line.match(/^\S+ \S+ .* (\d{9,12}) [+-]\d{4}\t(commit[^:]*):/)
    if (m && Number.parseInt(m[1], 10) >= sinceEpoch) {
      count++
      lastEpochMs = Math.max(lastEpochMs, Number.parseInt(m[1], 10) * 1000)
    }
  }
  return { count, lastEpochMs }
}

function commitsSince(cwd, sinceIso) {
  return commitActivitySince(cwd, sinceIso).count
}

/**
 * Pure stop-gate decision, unit-testable in isolation. Blocks only the
 * combination that loses engineering truth: enforced mode, commits made this
 * session, and no state update accounting for them. The state update must
 * FOLLOW the last commit — a state touch early in the session does not
 * account for commits made after it. `stopHookActive` means the agent
 * already continued past one block — never loop.
 */
function decideStopGate({ enforced, stopHookActive, stateExists, commitsThisSession, stateUpdatedAfterLastCommit }) {
  if (!enforced || stopHookActive || commitsThisSession === 0)
    return { block: false }
  if (!stateExists) {
    return {
      block: true,
      reason: 'Octowiz enforced mode: this session made commits but the repository has no engineering state. Run `octowiz state init`, record the goal and evidence (`octowiz state evidence ...`), and transition state before ending — or toggle off with `octowiz enforce off`.',
    }
  }
  if (!stateUpdatedAfterLastCommit) {
    return {
      block: true,
      reason: 'Octowiz enforced mode: this session made commits that no later engineering-state update accounts for. Record evidence (`octowiz state evidence <kind> <status> --ref <commit>`) and make the matching transition (`octowiz state transition <state>`) so the next session routes on current truth — a completion claim without a state transition is unverified.',
    }
  }
  return { block: false }
}

module.exports = {
  CONFIG_FILENAME,
  configFile,
  readConfig,
  isEnforced,
  setEnforced,
  resolveGitDir,
  commitActivitySince,
  commitsSince,
  decideStopGate,
}
