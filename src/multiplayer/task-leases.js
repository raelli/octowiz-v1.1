'use strict'

// Task Leases — exclusive execution rights for bounded durations.
// A lease grants one session the right to work on a task. Leases must be
// renewed before expiry. Expired leases are reclaimable by other sessions.

const crypto = require('node:crypto')

const DEFAULT_LEASE_DURATION_MS = 300_000 // 5 minutes

/**
 * @typedef {object} Lease
 * @property {string} taskId
 * @property {string} sessionId
 * @property {string} token - opaque lease token for renewal/release
 * @property {string} grantedAt - ISO-8601
 * @property {string} expiresAt - ISO-8601
 * @property {'active'|'expired'|'released'} status
 */

/**
 * Create a task lease manager.
 *
 * @param {object} [options]
 * @param {number} [options.leaseDurationMs] default lease duration
 * @returns {TaskLeaseManager}
 */
function createTaskLeaseManager({ leaseDurationMs = DEFAULT_LEASE_DURATION_MS } = {}) {
  /** @type {Map<string, Lease>} taskId → lease */
  const leases = new Map()

  function _generateToken() {
    return crypto.randomBytes(16).toString('hex')
  }

  function _isExpired(lease) {
    return new Date(lease.expiresAt).getTime() < Date.now()
  }

  /**
   * Claim a task lease. Returns the lease token on success.
   *
   * @param {string} taskId
   * @param {string} sessionId
   * @param {object} [options]
   * @param {number} [options.durationMs] custom lease duration
   * @returns {{ ok: true, token: string, expiresAt: string } | { ok: false, reason: string, owner: string }}
   */
  function claim(taskId, sessionId, { durationMs } = {}) {
    const existing = leases.get(taskId)

    if (existing && existing.status === 'active') {
      if (_isExpired(existing)) {
        // Expired — allow reclaim
        existing.status = 'expired'
      }
      else if (existing.sessionId === sessionId) {
        // Idempotent: same session re-claiming is a renewal
        return renew(existing.token)
      }
      else {
        // Another session holds the lease
        return { ok: false, reason: 'already claimed', owner: existing.sessionId }
      }
    }

    const now = new Date()
    const duration = durationMs ?? leaseDurationMs
    const token = _generateToken()
    const lease = {
      taskId,
      sessionId,
      token,
      grantedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + duration).toISOString(),
      status: 'active',
    }
    leases.set(taskId, lease)
    return { ok: true, token, expiresAt: lease.expiresAt }
  }

  /**
   * Renew a lease by token. Extends the expiry.
   *
   * @param {string} token
   * @param {object} [options]
   * @param {number} [options.durationMs] custom renewal duration
   * @returns {{ ok: true, token: string, expiresAt: string } | { ok: false, reason: string }}
   */
  function renew(token, { durationMs } = {}) {
    for (const lease of leases.values()) {
      if (lease.token === token) {
        if (lease.status !== 'active')
          return { ok: false, reason: 'lease is not active' }
        if (_isExpired(lease)) {
          lease.status = 'expired'
          return { ok: false, reason: 'lease has expired' }
        }
        const duration = durationMs ?? leaseDurationMs
        lease.expiresAt = new Date(Date.now() + duration).toISOString()
        return { ok: true, token: lease.token, expiresAt: lease.expiresAt }
      }
    }
    return { ok: false, reason: 'unknown lease token' }
  }

  /**
   * Release a lease by token.
   * @param {string} token
   * @returns {boolean} true if lease was found and released
   */
  function release(token) {
    for (const [taskId, lease] of leases) {
      if (lease.token === token) {
        lease.status = 'released'
        leases.delete(taskId)
        return true
      }
    }
    return false
  }

  /**
   * Get the active lease for a task.
   * @param {string} taskId
   * @returns {Lease|null}
   */
  function getLease(taskId) {
    const lease = leases.get(taskId)
    if (!lease)
      return null
    if (lease.status === 'active' && _isExpired(lease)) {
      lease.status = 'expired'
    }
    return lease.status === 'active' ? lease : null
  }

  /**
   * Get all active leases.
   * @returns {Lease[]}
   */
  function activeLeases() {
    const result = []
    for (const lease of leases.values()) {
      if (lease.status === 'active') {
        if (_isExpired(lease))
          lease.status = 'expired'
        else
          result.push(lease)
      }
    }
    return result
  }

  /**
   * Expire and remove all stale leases.
   * @returns {number} number of leases expired
   */
  function expireStale() {
    let count = 0
    for (const [taskId, lease] of leases) {
      if (lease.status === 'active' && _isExpired(lease)) {
        lease.status = 'expired'
        leases.delete(taskId)
        count++
      }
    }
    return count
  }

  return {
    claim,
    renew,
    release,
    getLease,
    activeLeases,
    expireStale,
  }
}

module.exports = { createTaskLeaseManager, DEFAULT_LEASE_DURATION_MS }
