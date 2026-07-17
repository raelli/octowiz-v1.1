'use strict'

// Shared Steering — human override commands that affect all sessions.
// pause/resume halts or resumes autonomous dispatch globally.
// redirect changes a session's current task/capability.
// Human gates block autonomous sessions and emit notifications.

const fs = require('node:fs')
const path = require('node:path')
const { deriveRepositoryId } = require('../state/repository-id')
const { runtimeFile } = require('../state/runtime')

/**
 * @typedef {object} SteeringState
 * @property {boolean} paused - whether all dispatch is paused
 * @property {string|null} pausedAt - ISO-8601 when paused
 * @property {string|null} pausedBy - who paused (session id or 'human')
 * @property {string|null} pauseReason - reason for pause
 * @property {Array<{sessionId: string, capability: string, at: string}>} redirections
 * @property {Array<{sessionId: string, capability: string, reason: string, at: string}>} humanGates
 */

/**
 * Create a steering controller.
 *
 * @param {object} options
 * @param {string} [options.storePath] path to persist steering state
 * @param {(notification: object) => void} [options.onNotify] callback for notifications
 * @returns {SteeringController}
 */
function createSteering({ storePath, onNotify } = {}) {
  function _read() {
    if (!storePath)
      return _emptyState()
    try {
      return JSON.parse(fs.readFileSync(storePath, 'utf8'))
    }
    catch {
      return _emptyState()
    }
  }

  function _write(state) {
    if (!storePath)
      return
    fs.mkdirSync(path.dirname(storePath), { recursive: true })
    fs.writeFileSync(storePath, `${JSON.stringify(state, null, 2)}\n`)
  }

  function _emptyState() {
    return {
      paused: false,
      pausedAt: null,
      pausedBy: null,
      pauseReason: null,
      redirections: [],
      humanGates: [],
    }
  }

  /**
   * Pause all autonomous dispatch.
   * @param {object} [options]
   * @param {string} [options.by] who is pausing
   * @param {string} [options.reason] why
   */
  function pause({ by = 'human', reason = null } = {}) {
    const state = _read()
    state.paused = true
    state.pausedAt = new Date().toISOString()
    state.pausedBy = by
    state.pauseReason = reason
    _write(state)
    _notify({ type: 'steering.paused', by, reason })
  }

  /**
   * Resume autonomous dispatch.
   */
  function resume() {
    const state = _read()
    state.paused = false
    state.pausedAt = null
    state.pausedBy = null
    state.pauseReason = null
    _write(state)
    _notify({ type: 'steering.resumed' })
  }

  /**
   * Check if dispatch is currently paused.
   * @returns {boolean}
   */
  function isPaused() {
    return _read().paused
  }

  /**
   * Redirect a session to a different capability.
   * @param {string} sessionId
   * @param {string} capability
   */
  function redirect(sessionId, capability) {
    const state = _read()
    state.redirections = state.redirections.filter(r => r.sessionId !== sessionId)
    state.redirections.push({ sessionId, capability, at: new Date().toISOString() })
    _write(state)
    _notify({ type: 'steering.redirect', sessionId, capability })
  }

  /**
   * Get the pending redirection for a session, if any.
   * @param {string} sessionId
   * @returns {{ capability: string } | null}
   */
  function getRedirection(sessionId) {
    const state = _read()
    const redir = state.redirections.find(r => r.sessionId === sessionId)
    return redir ? { capability: redir.capability } : null
  }

  /**
   * Acknowledge and clear a redirection.
   * @param {string} sessionId
   */
  function clearRedirection(sessionId) {
    const state = _read()
    state.redirections = state.redirections.filter(r => r.sessionId !== sessionId)
    _write(state)
  }

  /**
   * Record that an autonomous session hit a human gate.
   * @param {string} sessionId
   * @param {string} capability
   * @param {string} reason
   */
  function recordHumanGate(sessionId, capability, reason) {
    const state = _read()
    state.humanGates.push({
      sessionId,
      capability,
      reason,
      at: new Date().toISOString(),
    })
    _write(state)
    _notify({ type: 'steering.human-gate', sessionId, capability, reason })
  }

  /**
   * Get all pending human gates.
   * @returns {Array<{sessionId: string, capability: string, reason: string, at: string}>}
   */
  function pendingHumanGates() {
    return _read().humanGates
  }

  /**
   * Clear a specific human gate.
   * @param {string} sessionId
   */
  function clearHumanGate(sessionId) {
    const state = _read()
    state.humanGates = state.humanGates.filter(g => g.sessionId !== sessionId)
    _write(state)
  }

  /**
   * Get the full steering state.
   * @returns {SteeringState}
   */
  function getState() {
    return _read()
  }

  function _notify(notification) {
    if (onNotify) {
      try {
        onNotify(notification)
      }
      catch {
        // Notification failures are non-fatal
      }
    }
  }

  /**
   * Check whether an autonomous session should proceed with dispatch.
   * Returns false if paused or if the session has a pending human gate.
   *
   * @param {string} sessionId
   * @returns {{ allowed: boolean, reason?: string }}
   */
  function canDispatch(sessionId) {
    const state = _read()
    if (state.paused)
      return { allowed: false, reason: `dispatch paused${state.pauseReason ? `: ${state.pauseReason}` : ''}` }

    const gate = state.humanGates.find(g => g.sessionId === sessionId)
    if (gate)
      return { allowed: false, reason: `human gate: ${gate.reason}` }

    return { allowed: true }
  }

  return {
    pause,
    resume,
    isPaused,
    redirect,
    getRedirection,
    clearRedirection,
    recordHumanGate,
    pendingHumanGates,
    clearHumanGate,
    canDispatch,
    getState,
  }
}

/**
 * Create steering backed by the repository's machine-local runtime directory.
 * @param {string} cwd repository root
 * @param {(notification: object) => void} [onNotify]
 * @returns {SteeringController}
 */
function createRepositorySteering(cwd, onNotify) {
  const repositoryId = deriveRepositoryId(cwd)
  const storePath = path.join(path.dirname(runtimeFile(repositoryId)), 'steering.json')
  return createSteering({ storePath, onNotify })
}

module.exports = { createSteering, createRepositorySteering }
