'use strict'

// Session Ledger — multi-session tracking for concurrent agent/human work.
// Extends the runtime store with session registration, heartbeat, and
// stale detection. This is the foundation for multiplayer ownership.

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const DEFAULT_HEARTBEAT_TTL_MS = 300_000 // 5 minutes

/**
 * @typedef {object} SessionEntry
 * @property {string} sessionId
 * @property {string} runtime - runtime adapter id
 * @property {string} actor - 'human-assisted' | 'autonomous' | 'hybrid'
 * @property {string|null} worktree - worktree path or null for main tree
 * @property {string[]} ownedFiles - files claimed by this session
 * @property {string|null} ownedTask - task id being worked on
 * @property {string} startedAt - ISO-8601
 * @property {string} lastHeartbeat - ISO-8601
 * @property {'active'|'stale'|'ended'} status
 */

/**
 * @typedef {object} SessionLedger
 * @property {string} repositoryId
 * @property {SessionEntry[]} sessions
 * @property {string} updatedAt
 */

/**
 * Create a session ledger manager for a repository.
 *
 * @param {object} options
 * @param {string} options.repositoryId
 * @param {string} [options.storePath] explicit path (for testing); defaults to cache dir
 * @param {number} [options.heartbeatTtlMs] TTL before a session is considered stale
 * @returns {SessionLedgerManager}
 */
function createSessionLedger({ repositoryId, storePath, heartbeatTtlMs = DEFAULT_HEARTBEAT_TTL_MS }) {
  const filePath = storePath ?? _defaultStorePath(repositoryId)

  function _read() {
    try {
      const raw = fs.readFileSync(filePath, 'utf8')
      const doc = JSON.parse(raw)
      if (doc && Array.isArray(doc.sessions))
        return doc
    }
    catch {}
    return { repositoryId, sessions: [], updatedAt: new Date().toISOString() }
  }

  function _write(doc) {
    doc.updatedAt = new Date().toISOString()
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    const tmp = `${filePath}.tmp-${process.pid}`
    fs.writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`)
    fs.renameSync(tmp, filePath)
  }

  /**
   * Register a new session or refresh an existing one.
   * @param {object} entry
   * @param {string} entry.sessionId
   * @param {string} [entry.runtime]
   * @param {string} [entry.actor]
   * @param {string|null} [entry.worktree]
   * @param {string|null} [entry.ownedTask]
   * @returns {SessionEntry}
   */
  function register({ sessionId, runtime = 'claude-code', actor = 'human-assisted', worktree = null, ownedTask = null, ownedFiles = null }) {
    const doc = _read()
    const now = new Date().toISOString()
    const existing = doc.sessions.find(s => s.sessionId === sessionId)

    if (existing) {
      existing.status = 'active'
      existing.lastHeartbeat = now
      existing.runtime = runtime
      existing.actor = actor
      if (worktree !== null)
        existing.worktree = worktree
      if (ownedTask !== null)
        existing.ownedTask = ownedTask
      if (ownedFiles !== null)
        existing.ownedFiles = ownedFiles
      _write(doc)
      return existing
    }

    const entry = {
      sessionId,
      runtime,
      actor,
      worktree,
      ownedFiles: ownedFiles ?? [],
      ownedTask,
      startedAt: now,
      lastHeartbeat: now,
      status: 'active',
    }
    doc.sessions.push(entry)
    _write(doc)
    return entry
  }

  /**
   * Update heartbeat for a session.
   * @param {string} sessionId
   * @returns {boolean} true if session was found and updated
   */
  function heartbeat(sessionId) {
    const doc = _read()
    const session = doc.sessions.find(s => s.sessionId === sessionId)
    if (!session)
      return false
    session.lastHeartbeat = new Date().toISOString()
    session.status = 'active'
    _write(doc)
    return true
  }

  /**
   * Release (end) a session.
   * @param {string} sessionId
   * @returns {boolean} true if session was found and ended
   */
  function release(sessionId) {
    const doc = _read()
    const idx = doc.sessions.findIndex(s => s.sessionId === sessionId)
    if (idx === -1)
      return false
    doc.sessions.splice(idx, 1)
    _write(doc)
    return true
  }

  /**
   * Get all active sessions.
   * @returns {SessionEntry[]}
   */
  function activeSessions() {
    const doc = _read()
    _expireStale(doc)
    return doc.sessions.filter(s => s.status === 'active')
  }

  /**
   * Get all sessions (including stale).
   * @returns {SessionEntry[]}
   */
  function allSessions() {
    const doc = _read()
    _expireStale(doc)
    return [...doc.sessions]
  }

  /**
   * Find a session by id.
   * @param {string} sessionId
   * @returns {SessionEntry|null}
   */
  function getSession(sessionId) {
    const doc = _read()
    return doc.sessions.find(s => s.sessionId === sessionId) ?? null
  }

  /**
   * Mark sessions as stale if their heartbeat has expired.
   * Writes back if any sessions were marked stale.
   */
  function _expireStale(doc) {
    const now = Date.now()
    let changed = false
    for (const session of doc.sessions) {
      if (session.status === 'active') {
        const lastBeat = new Date(session.lastHeartbeat).getTime()
        if (now - lastBeat > heartbeatTtlMs) {
          session.status = 'stale'
          changed = true
        }
      }
    }
    if (changed)
      _write(doc)
  }

  /**
   * Remove all stale sessions from the ledger.
   * @returns {number} number of sessions removed
   */
  function purgeStale() {
    const doc = _read()
    _expireStale(doc)
    const before = doc.sessions.length
    doc.sessions = doc.sessions.filter(s => s.status !== 'stale')
    _write(doc)
    return before - doc.sessions.length
  }

  return {
    register,
    heartbeat,
    release,
    activeSessions,
    allSessions,
    getSession,
    purgeStale,
  }
}

function _defaultStorePath(repositoryId) {
  const slug = repositoryId.replace(/[^\w-]/g, '_')
  const base = process.env.OCTOWIZ_RUNTIME_DIR
    || path.join(os.homedir() || os.tmpdir(), '.cache', 'octowiz')
  return path.join(base, slug, 'sessions.json')
}

module.exports = { createSessionLedger, DEFAULT_HEARTBEAT_TTL_MS }
