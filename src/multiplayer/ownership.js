'use strict'

// Ownership — advisory and strict file/task ownership claims across sessions.
// A file can be owned by at most one session. Ownership is checked on claim
// and optionally enforced (strict mode blocks the second claimant).

/**
 * @typedef {object} OwnershipConflict
 * @property {string} file - the conflicting file path
 * @property {string} owner - session id of the current owner
 * @property {string} claimant - session id attempting to claim
 */

/**
 * Create an ownership manager backed by a session ledger.
 *
 * @param {object} options
 * @param {ReturnType<import('./sessions').createSessionLedger>} options.ledger
 * @param {boolean} [options.strict] if true, conflicts throw; if false, they warn
 * @returns {OwnershipManager}
 */
function createOwnershipManager({ ledger, strict = false }) {
  /**
   * Claim ownership of files for a session.
   * Returns conflicts if any files are already owned by another session.
   *
   * @param {string} sessionId
   * @param {string[]} files - relative file paths to claim
   * @returns {{ claimed: string[], conflicts: OwnershipConflict[] }}
   * @throws {Error} in strict mode when conflicts exist
   */
  function claimFiles(sessionId, files) {
    const sessions = ledger.activeSessions()
    const conflicts = []
    const claimed = []

    for (const file of files) {
      const owner = sessions.find(s => s.sessionId !== sessionId && s.ownedFiles.includes(file))
      if (owner) {
        conflicts.push({ file, owner: owner.sessionId, claimant: sessionId })
      }
      else {
        claimed.push(file)
      }
    }

    if (strict && conflicts.length > 0) {
      const detail = conflicts.map(c => `${c.file} (owned by ${c.owner})`).join(', ')
      throw new Error(`ownership conflict in strict mode: ${detail}`)
    }

    // Update the session's owned files
    if (claimed.length > 0) {
      const session = ledger.getSession(sessionId)
      if (session) {
        const current = new Set(session.ownedFiles)
        for (const f of claimed) current.add(f)
        session.ownedFiles = [...current]
        // Re-register to persist the change
        ledger.register({ ...session })
      }
    }

    return { claimed, conflicts }
  }

  /**
   * Release ownership of specific files.
   * @param {string} sessionId
   * @param {string[]} files
   */
  function releaseFiles(sessionId, files) {
    const session = ledger.getSession(sessionId)
    if (!session)
      return

    const toRelease = new Set(files)
    session.ownedFiles = session.ownedFiles.filter(f => !toRelease.has(f))
    ledger.register({ ...session })
  }

  /**
   * Release all file ownership for a session.
   * @param {string} sessionId
   */
  function releaseAll(sessionId) {
    const session = ledger.getSession(sessionId)
    if (!session)
      return
    session.ownedFiles = []
    ledger.register({ ...session })
  }

  /**
   * Get the owner of a specific file.
   * @param {string} file
   * @returns {{ sessionId: string, runtime: string } | null}
   */
  function getFileOwner(file) {
    const sessions = ledger.activeSessions()
    const owner = sessions.find(s => s.ownedFiles.includes(file))
    if (!owner)
      return null
    return { sessionId: owner.sessionId, runtime: owner.runtime }
  }

  /**
   * Get all files owned across all active sessions.
   * @returns {Map<string, string>} file → sessionId
   */
  function allOwnedFiles() {
    const sessions = ledger.activeSessions()
    const map = new Map()
    for (const session of sessions) {
      for (const file of session.ownedFiles) {
        map.set(file, session.sessionId)
      }
    }
    return map
  }

  /**
   * Check if a set of files would conflict with existing ownership.
   * Does not claim — just checks.
   *
   * @param {string} sessionId
   * @param {string[]} files
   * @returns {OwnershipConflict[]}
   */
  function checkConflicts(sessionId, files) {
    const sessions = ledger.activeSessions()
    const conflicts = []
    for (const file of files) {
      const owner = sessions.find(s => s.sessionId !== sessionId && s.ownedFiles.includes(file))
      if (owner) {
        conflicts.push({ file, owner: owner.sessionId, claimant: sessionId })
      }
    }
    return conflicts
  }

  return {
    claimFiles,
    releaseFiles,
    releaseAll,
    getFileOwner,
    allOwnedFiles,
    checkConflicts,
  }
}

module.exports = { createOwnershipManager }
