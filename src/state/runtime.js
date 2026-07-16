'use strict'

// Machine-local runtime store — the ephemeral counterpart of the durable
// repository state. Lives outside the repository (user cache directory) and
// is the ONLY place for PIDs, ports, session IDs, absolute paths, leases and
// heartbeats. Nothing here is ever committed or synchronized.

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { repositoryIdSlug } = require('./repository-id')

const RUNTIME_VERSION = '0.1'
const RUNTIME_FILENAME = 'runtime.json'

function runtimeBaseDir() {
  const explicit = process.env.OCTOWIZ_RUNTIME_DIR
  if (typeof explicit === 'string' && explicit.trim())
    return explicit.trim()
  return path.join(os.homedir() || os.tmpdir(), '.cache', 'octowiz')
}

function runtimeFile(repositoryId) {
  return path.join(runtimeBaseDir(), repositoryIdSlug(repositoryId), RUNTIME_FILENAME)
}

function emptyRuntime(repositoryId, now) {
  return {
    runtimeVersion: RUNTIME_VERSION,
    repositoryId,
    machine: os.hostname(),
    sessions: [],
    updatedAt: now,
  }
}

/**
 * @param {string} repositoryId
 * @returns {object} current runtime document (empty shape when absent/broken)
 */
function readRuntime(repositoryId) {
  const file = runtimeFile(repositoryId)
  try {
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (doc && Array.isArray(doc.sessions))
      return doc
  }
  catch {}
  return emptyRuntime(repositoryId, new Date().toISOString())
}

function writeRuntime(repositoryId, doc) {
  const file = runtimeFile(repositoryId)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  // Ephemeral data: a plain temp+rename is enough; losing it costs a lease,
  // never engineering truth.
  const tmp = `${file}.tmp-${process.pid}`
  fs.writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`)
  fs.renameSync(tmp, file)
}

/**
 * Registers (or refreshes) a runtime session. Machine-local by design: PID,
 * absolute repository root and worktree paths belong here.
 * @param {string} repositoryId
 * @param {object} session
 * @param {string} session.sessionId
 * @param {string} [session.runtime]
 * @param {number} [session.pid]
 * @param {string} [session.repositoryRoot]
 * @param {string} [session.worktree]
 * @param {string} [now]
 */
function registerSession(repositoryId, { sessionId, runtime = 'claude-code', pid = null, repositoryRoot = null, worktree = null }, now = new Date().toISOString()) {
  const doc = readRuntime(repositoryId)
  const existing = doc.sessions.find(s => s.sessionId === sessionId)
  if (existing) {
    existing.status = 'active'
    existing.lastSeenAt = now
    existing.pid = pid ?? existing.pid
  }
  else {
    doc.sessions.push({
      sessionId,
      runtime,
      pid,
      repositoryRoot,
      worktree,
      status: 'active',
      startedAt: now,
      lastSeenAt: now,
    })
  }
  doc.updatedAt = now
  writeRuntime(repositoryId, doc)
  return doc
}

function heartbeat(repositoryId, sessionId, now = new Date().toISOString()) {
  const doc = readRuntime(repositoryId)
  const session = doc.sessions.find(s => s.sessionId === sessionId)
  if (!session)
    return doc
  session.lastSeenAt = now
  doc.updatedAt = now
  writeRuntime(repositoryId, doc)
  return doc
}

/**
 * Releases a session lease. Durable engineering state is untouched by design:
 * a session ending never means the work is complete.
 */
function releaseSession(repositoryId, sessionId, now = new Date().toISOString()) {
  const doc = readRuntime(repositoryId)
  doc.sessions = doc.sessions.filter(s => s.sessionId !== sessionId)
  doc.updatedAt = now
  writeRuntime(repositoryId, doc)
  return doc
}

// Guard for the CLI: machine-local runtime data must never sit inside the
// repository where it could be committed.
function runtimeFileInsideRepo(cwd) {
  const candidate = path.join(path.resolve(cwd), '.octowiz', RUNTIME_FILENAME)
  return fs.existsSync(candidate) ? candidate : null
}

module.exports = {
  RUNTIME_VERSION,
  runtimeBaseDir,
  runtimeFile,
  readRuntime,
  registerSession,
  heartbeat,
  releaseSession,
  runtimeFileInsideRepo,
}
