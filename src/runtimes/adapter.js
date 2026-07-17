'use strict'

// Abstract runtime adapter interface. Runtimes (Claude Code, OpenCode, Daytona,
// etc.) implement this contract to participate in Octowiz coordination.
//
// This is a duck-typed interface defined via JSDoc — no class hierarchy.
// Adapters are plain objects that satisfy the contract. The registry and
// dispatch engine validate compliance at registration time.

/**
 * @typedef {object} RuntimeAdapter
 * @property {string} id - unique runtime identifier (e.g. 'claude-code')
 * @property {string} name - human-readable display name
 * @property {() => Promise<boolean>} isAvailable - can this runtime be reached right now?
 * @property {(task: import('./types').TaskEnvelope) => Promise<import('./types').TaskResult>} dispatch - send a task for execution
 * @property {() => Promise<import('./types').RuntimeStatus>} status - health/session info
 * @property {(event: import('./types').OctowizEvent) => void} notify - fire-and-forget event push
 */

/**
 * Required fields for a valid RuntimeAdapter.
 */
const REQUIRED_FIELDS = ['id', 'name', 'isAvailable', 'dispatch', 'status', 'notify']

/**
 * Validate that an object satisfies the RuntimeAdapter contract.
 * Returns an array of issues (empty if valid).
 *
 * @param {*} adapter candidate adapter object
 * @returns {string[]} list of validation issues (empty = valid)
 */
function validateAdapter(adapter) {
  const issues = []

  if (!adapter || typeof adapter !== 'object') {
    issues.push('adapter must be a non-null object')
    return issues
  }

  if (typeof adapter.id !== 'string' || !adapter.id.trim())
    issues.push('adapter.id must be a non-empty string')

  if (typeof adapter.name !== 'string' || !adapter.name.trim())
    issues.push('adapter.name must be a non-empty string')

  if (typeof adapter.isAvailable !== 'function')
    issues.push('adapter.isAvailable must be a function')

  if (typeof adapter.dispatch !== 'function')
    issues.push('adapter.dispatch must be a function')

  if (typeof adapter.status !== 'function')
    issues.push('adapter.status must be a function')

  if (typeof adapter.notify !== 'function')
    issues.push('adapter.notify must be a function')

  return issues
}

/**
 * Assert that an adapter is valid. Throws if it does not satisfy the contract.
 * @param {*} adapter
 * @throws {Error} with all issues listed
 */
function assertValidAdapter(adapter) {
  const issues = validateAdapter(adapter)
  if (issues.length > 0)
    throw new Error(`invalid runtime adapter: ${issues.join('; ')}`)
}

/**
 * Create a mock adapter for testing. All methods return sensible defaults.
 * Override specific methods by passing them in `overrides`.
 *
 * @param {Partial<RuntimeAdapter>} [overrides]
 * @returns {RuntimeAdapter} the mock adapter
 */
function createMockAdapter(overrides = {}) {
  return {
    id: overrides.id ?? 'mock-runtime',
    name: overrides.name ?? 'Mock Runtime',
    isAvailable: overrides.isAvailable ?? (async () => true),
    dispatch: overrides.dispatch ?? (async () => ({
      status: 'completed',
      summary: 'mock task completed',
      evidence: {},
      artifacts: [],
    })),
    status: overrides.status ?? (async () => ({
      available: true,
      sessions: 0,
      uptime: 0,
    })),
    notify: overrides.notify ?? (() => {}),
  }
}

module.exports = {
  REQUIRED_FIELDS,
  validateAdapter,
  assertValidAdapter,
  createMockAdapter,
}
