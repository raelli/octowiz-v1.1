'use strict'

// OpenCode Runtime Adapter (stub) — declares the interface for headless
// OpenCode execution but returns deferred for all dispatch calls. Real
// implementation will arrive when OpenCode is deployed as a target runtime.
//
// OpenCode is an open-source terminal-based coding agent. When available,
// Octowiz can route tasks to it for headless execution in a separate process.

const net = require('node:net')

/**
 * Create an OpenCode runtime adapter stub.
 *
 * @param {object} [options]
 * @param {string} [options.host] OpenCode process host (default: '127.0.0.1')
 * @param {number} [options.port] OpenCode API port (default: OPENCODE_PORT or 9100)
 * @param {number} [options.timeoutMs] connection probe timeout (default: 1000)
 * @returns {import('./adapter').RuntimeAdapter}
 */
function createOpenCodeAdapter(options = {}) {
  const host = options.host ?? '127.0.0.1'
  const port = options.port ?? _defaultPort()
  const timeoutMs = options.timeoutMs ?? 1000

  /**
   * Check whether the OpenCode process is reachable by probing its port.
   * @type {import('./adapter').RuntimeAdapter['isAvailable']}
   */
  async function isAvailable() {
    return _isPortOpen(host, port, timeoutMs)
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
        reason: reachable ? 'process reachable but adapter not implemented' : 'process not reachable',
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
      summary: `opencode adapter is a stub; cannot execute ${task.capability}`,
      error: 'runtime not implemented',
    }
  }

  /** @type {import('./adapter').RuntimeAdapter['notify']} */
  function notify() {
    // Stub: no event forwarding
  }

  return {
    id: 'opencode',
    name: 'OpenCode',
    isAvailable,
    status,
    dispatch,
    notify,
  }
}

function _defaultPort() {
  const raw = process.env.OPENCODE_PORT
  if (raw) {
    const parsed = Number(raw)
    if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535)
      return parsed
  }
  return 9100
}

function _isPortOpen(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port })
    const timer = setTimeout(() => { socket.destroy(); resolve(false) }, timeoutMs)
    timer.unref?.()
    socket.once('connect', () => { clearTimeout(timer); socket.destroy(); resolve(true) })
    socket.once('error', () => { clearTimeout(timer); resolve(false) })
  })
}

module.exports = { createOpenCodeAdapter }
