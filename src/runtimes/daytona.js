'use strict'

// Daytona Runtime Adapter (stub) — declares the interface for sandboxed
// execution via Daytona but returns deferred for all dispatch calls. Real
// implementation will arrive when Daytona integration is built.
//
// Daytona provides secure sandboxed development environments. When available,
// Octowiz can route tasks to a Daytona workspace for isolated execution.

const http = require('node:http')

/**
 * Create a Daytona runtime adapter stub.
 *
 * @param {object} [options]
 * @param {string} [options.apiUrl] Daytona API base URL (default: DAYTONA_API_URL or http://localhost:3986)
 * @param {number} [options.timeoutMs] HTTP probe timeout (default: 2000)
 * @returns {import('./adapter').RuntimeAdapter}
 */
function createDaytonaAdapter(options = {}) {
  const apiUrl = options.apiUrl ?? _defaultApiUrl()
  const timeoutMs = options.timeoutMs ?? 2000

  /**
   * Check whether the Daytona API is reachable.
   * @type {import('./adapter').RuntimeAdapter['isAvailable']}
   */
  async function isAvailable() {
    return _probeHttp(apiUrl, timeoutMs)
  }

  /** @type {import('./adapter').RuntimeAdapter['status']} */
  async function status() {
    const reachable = await isAvailable()
    return {
      available: reachable,
      sessions: 0,
      uptime: 0,
      metadata: {
        stub: true,
        apiUrl,
        reason: reachable ? 'API reachable but adapter not implemented' : 'API not reachable',
      },
    }
  }

  /**
   * Dispatch always returns deferred — the adapter is a stub.
   * @type {import('./adapter').RuntimeAdapter['dispatch']}
   */
  async function dispatch(task) {
    return {
      status: 'deferred',
      summary: `daytona adapter is a stub; cannot execute ${task.capability}`,
      error: 'runtime not implemented',
    }
  }

  /** @type {import('./adapter').RuntimeAdapter['notify']} */
  function notify() {
    // Stub: no event forwarding
  }

  return {
    id: 'daytona',
    name: 'Daytona',
    isAvailable,
    status,
    dispatch,
    notify,
  }
}

function _defaultApiUrl() {
  return process.env.DAYTONA_API_URL || 'http://localhost:3986'
}

/**
 * Probe an HTTP URL by attempting a GET request to its root.
 * Returns true if we get any response; false on connection failure or timeout.
 */
function _probeHttp(baseUrl, timeoutMs) {
  return new Promise((resolve) => {
    let url
    try {
      url = new URL('/health', baseUrl)
    }
    catch {
      resolve(false)
      return
    }

    const req = http.get({
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname,
      timeout: timeoutMs,
    }, (res) => {
      // Any response means reachable
      res.resume()
      resolve(res.statusCode < 500)
    })
    req.once('timeout', () => { req.destroy(); resolve(false) })
    req.once('error', () => resolve(false))
  })
}

module.exports = { createDaytonaAdapter }
