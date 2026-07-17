'use strict'

// Claude Code Runtime Adapter — wraps the existing local supervisor, daemon,
// and A2A transport into the RuntimeAdapter contract. This is the default
// runtime for Octowiz when running inside a Claude Code session.
//
// Key insight: Claude Code is the *active* coding session. dispatch() is
// advisory — it tells the state machine what the session should do next.
// The session itself (the Claude Code agent) executes the work. notify()
// forwards events to AELLI for observability.

const http = require('node:http')

/**
 * Create a Claude Code runtime adapter.
 *
 * @param {object} [options]
 * @param {string} [options.host] supervisor host (default: '127.0.0.1')
 * @param {number} [options.port] supervisor port (default: OCTOWIZ_LOCAL_PORT or 8764)
 * @param {number} [options.timeoutMs] HTTP timeout for health checks (default: 2000)
 * @param {string} [options.repositoryId] repository id for runtime store queries
 * @returns {import('./adapter').RuntimeAdapter}
 */
function createClaudeCodeAdapter(options = {}) {
  const host = options.host ?? '127.0.0.1'
  const port = options.port ?? _defaultPort()
  const timeoutMs = options.timeoutMs ?? 2000
  const repositoryId = options.repositoryId ?? null

  /**
   * GET the supervisor health endpoint and parse the JSON response.
   * Returns null on any failure (timeout, connection refused, parse error).
   */
  function _fetchHealth() {
    return new Promise((resolve) => {
      const req = http.get({ host, port, path: '/health', timeout: timeoutMs }, (res) => {
        let raw = ''
        res.on('data', chunk => (raw += chunk))
        res.once('end', () => {
          try {
            resolve(JSON.parse(raw))
          }
          catch {
            resolve(null)
          }
        })
      })
      req.once('timeout', () => { req.destroy(); resolve(null) })
      req.once('error', () => resolve(null))
    })
  }

  /** @type {import('./adapter').RuntimeAdapter['isAvailable']} */
  async function isAvailable() {
    const health = await _fetchHealth()
    return health?.status === 'ok'
  }

  /** @type {import('./adapter').RuntimeAdapter['status']} */
  async function status() {
    const health = await _fetchHealth()

    if (!health || health.status !== 'ok') {
      return {
        available: false,
        sessions: 0,
        uptime: 0,
        metadata: { reason: 'supervisor not reachable' },
      }
    }

    // Augment with runtime store info if repository is known
    let runtimeSessions = health.sessions ?? 0
    if (repositoryId) {
      try {
        const { readRuntime } = require('../state/runtime')
        const runtime = readRuntime(repositoryId)
        runtimeSessions = runtime.sessions.length
      }
      catch {
        // Runtime store unavailable — use supervisor count
      }
    }

    return {
      available: true,
      sessions: runtimeSessions,
      uptime: 0, // Supervisor doesn't report uptime; 0 is a safe default
      metadata: {
        pid: health.pid,
        version: health.version,
        mode: health.mode,
        a2a: health.a2a,
        name: health.name,
      },
    }
  }

  /**
   * Dispatch is advisory for Claude Code: the active session is already
   * executing. This method returns a deferred result indicating what the
   * session should do next. The actual execution happens in the Claude Code
   * agent that reads this recommendation.
   *
   * @type {import('./adapter').RuntimeAdapter['dispatch']}
   */
  async function dispatch(task) {
    // For Claude Code, dispatch is advisory — we're telling the session what
    // to do, not sending work to a remote executor. The session reads the
    // result and acts on it.
    const { resolveExecutionPolicy } = require('../execution/policy')
    const execution = task.execution ?? resolveExecutionPolicy()
    return {
      status: 'completed',
      summary: `${execution.pattern}: invoke ${task.provider}:${task.command} for capability ${task.capability}`,
      evidence: {
        capability: task.capability,
        provider: task.provider,
        command: task.command,
        execution,
      },
      artifacts: [],
    }
  }

  /**
   * Fire-and-forget event notification. Forwards to the A2A transport when
   * available; silently drops when the transport is not configured.
   *
   * @type {import('./adapter').RuntimeAdapter['notify']}
   */
  function notify(event) {
    // Best-effort forwarding — never throw from notify
    try {
      const { sendEvent } = require('../a2a-transport')
      const config = require('../config')
      const a2aUrl = config.a2aServerUrl()
      sendEvent(`${a2aUrl}/a2a/octowiz`, {
        method: 'octowiz/event',
        payload: event,
        headers: config.a2aServerAuthHeaders?.() ?? {},
        timeoutMs: 5000,
      }).catch(() => {
        // Swallow — notify is fire-and-forget
      })
    }
    catch {
      // Transport not available — acceptable for notify
    }
  }

  return {
    id: 'claude-code',
    name: 'Claude Code',
    isAvailable,
    status,
    dispatch,
    notify,
  }
}

function _defaultPort() {
  const raw = process.env.OCTOWIZ_LOCAL_PORT
  if (raw) {
    const parsed = Number(raw)
    if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535)
      return parsed
  }
  return 8764
}

module.exports = { createClaudeCodeAdapter }
