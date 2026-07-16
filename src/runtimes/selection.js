'use strict'

// Runtime Selection — determines which runtime adapter to use based on
// configuration, preference, and availability. Provides CLI commands for
// listing and selecting runtimes.
//
// Configuration lives in .octowiz/config.json (repository-local) under
// the "runtime" key. The selected runtime is advisory — if unavailable,
// the system falls back to the first available adapter.

const fs = require('node:fs')
const path = require('node:path')

const CONFIG_FILENAME = 'config.json'

/**
 * @typedef {object} RuntimeConfig
 * @property {string} [preferred] preferred runtime id
 * @property {Object<string, object>} [options] per-runtime options
 */

/**
 * Read the runtime preference from .octowiz/config.json.
 * Returns null if no config exists or no runtime preference is set.
 *
 * @param {string} cwd repository root
 * @returns {RuntimeConfig|null}
 */
function readRuntimeConfig(cwd) {
  const configPath = path.resolve(cwd, '.octowiz', CONFIG_FILENAME)
  try {
    const raw = fs.readFileSync(configPath, 'utf8')
    const doc = JSON.parse(raw)
    if (doc && typeof doc === 'object' && doc.runtime)
      return doc.runtime
    return null
  }
  catch {
    return null
  }
}

/**
 * Write or update the runtime preference in .octowiz/config.json.
 * Preserves other fields in the config file.
 *
 * @param {string} cwd repository root
 * @param {RuntimeConfig} runtimeConfig
 */
function writeRuntimeConfig(cwd, runtimeConfig) {
  const configPath = path.resolve(cwd, '.octowiz', CONFIG_FILENAME)
  let doc = {}
  try {
    const raw = fs.readFileSync(configPath, 'utf8')
    doc = JSON.parse(raw)
  }
  catch {
    // File doesn't exist or invalid — start fresh
  }
  doc.runtime = runtimeConfig
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  fs.writeFileSync(configPath, `${JSON.stringify(doc, null, 2)}\n`)
}

/**
 * Determine the preferred runtime for a repository.
 * Priority: explicit preference > config file > default ('claude-code').
 *
 * @param {object} [options]
 * @param {string} [options.cwd] repository root for config lookup
 * @param {string} [options.preference] explicit preference override
 * @returns {string} runtime id
 */
function getPreferredRuntime({ cwd, preference } = {}) {
  if (preference)
    return preference

  if (cwd) {
    const config = readRuntimeConfig(cwd)
    if (config?.preferred)
      return config.preferred
  }

  return 'claude-code'
}

/**
 * Select a runtime from the registry, respecting preference and falling back
 * to available adapters.
 *
 * @param {import('./registry').RuntimeRegistry} registry
 * @param {object} [options]
 * @param {string} [options.cwd] repository root for config lookup
 * @param {string} [options.preference] explicit preference override
 * @param {number} [options.timeoutMs] availability probe timeout
 * @returns {Promise<import('./adapter').RuntimeAdapter|null>}
 */
async function selectFromRegistry(registry, options = {}) {
  const preferred = getPreferredRuntime(options)
  return registry.selectRuntime(preferred, { timeoutMs: options.timeoutMs ?? 3000 })
}

module.exports = {
  readRuntimeConfig,
  writeRuntimeConfig,
  getPreferredRuntime,
  selectFromRegistry,
}
