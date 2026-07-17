'use strict'

// Runtime registry: registers, deregisters, and selects runtime adapters.
// A runtime must satisfy the RuntimeAdapter contract (validated on register).
// Selection picks the best available adapter — either by explicit preference
// or by availability probe.

const { assertValidAdapter } = require('./adapter')

/**
 * Create a new RuntimeRegistry instance. Each registry is independent
 * (no global state), making it testable and composable.
 *
 * @returns {RuntimeRegistry} the new registry
 */
function createRegistry() {
  /** @type {Map<string, import('./adapter').RuntimeAdapter>} */
  const adapters = new Map()

  /**
   * Register an adapter. Validates the contract on registration.
   * Overwrites an existing adapter with the same id.
   *
   * @param {import('./adapter').RuntimeAdapter} adapter
   * @throws {Error} if adapter does not satisfy the contract
   */
  function register(adapter) {
    assertValidAdapter(adapter)
    adapters.set(adapter.id, adapter)
  }

  /**
   * Deregister an adapter by id. No-op if not registered.
   * @param {string} id
   * @returns {boolean} true if an adapter was removed
   */
  function deregister(id) {
    return adapters.delete(id)
  }

  /**
   * Get a registered adapter by id.
   * @param {string} id
   * @returns {import('./adapter').RuntimeAdapter|null} the adapter, or null if not registered
   */
  function get(id) {
    return adapters.get(id) ?? null
  }

  /**
   * List all registered adapter ids.
   * @returns {string[]} registered adapter ids
   */
  function ids() {
    return [...adapters.keys()]
  }

  /**
   * Get all adapters that respond positively to `isAvailable()`.
   * Probes are run concurrently with a timeout.
   *
   * @param {object} [options]
   * @param {number} [options.timeoutMs] max ms to wait per probe (default: 3000)
   * @returns {Promise<import('./adapter').RuntimeAdapter[]>} adapters that are currently available
   */
  async function getAvailableRuntimes({ timeoutMs = 3000 } = {}) {
    const entries = [...adapters.values()]
    if (entries.length === 0)
      return []

    const results = await Promise.allSettled(
      entries.map(async (adapter) => {
        let timer
        const available = await Promise.race([
          adapter.isAvailable(),
          new Promise((resolve) => {
            timer = setTimeout(resolve, timeoutMs, false)
            timer.unref?.()
          }),
        ])
        clearTimeout(timer)
        return { adapter, available }
      }),
    )

    return results
      .filter(r => r.status === 'fulfilled' && r.value.available)
      .map(r => r.value.adapter)
  }

  /**
   * Select the best available runtime. If a preference is given and that
   * runtime is available, it wins. Otherwise, falls back to the first
   * available runtime (registration order).
   *
   * @param {string} [preference] preferred runtime id
   * @param {object} [options]
   * @param {number} [options.timeoutMs] availability probe timeout (default: 3000)
   * @returns {Promise<import('./adapter').RuntimeAdapter|null>} the selected runtime, or null if none available
   */
  async function selectRuntime(preference, options = {}) {
    // Fast path: if preference exists and is available, return it directly
    if (preference) {
      const preferred = adapters.get(preference)
      if (preferred) {
        try {
          let timer
          const available = await Promise.race([
            preferred.isAvailable(),
            new Promise((resolve) => {
              timer = setTimeout(resolve, options.timeoutMs ?? 3000, false)
              timer.unref?.()
            }),
          ])
          clearTimeout(timer)
          if (available)
            return preferred
        }
        catch {
          // Preferred not available — fall through to others
        }
      }
    }

    // Probe all adapters
    const available = await getAvailableRuntimes(options)
    return available.length > 0 ? available[0] : null
  }

  /**
   * Number of registered adapters.
   * @returns {number} adapter count
   */
  function size() {
    return adapters.size
  }

  /**
   * Remove all registered adapters.
   */
  function clear() {
    adapters.clear()
  }

  return {
    register,
    deregister,
    get,
    ids,
    size,
    clear,
    getAvailableRuntimes,
    selectRuntime,
  }
}

module.exports = { createRegistry }
