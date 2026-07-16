'use strict'

// Capability registry: loads the default registry from skills/registry.json,
// validates it, and resolves abstract capability names to concrete provider
// commands. This is the bridge between `src/state/next.js` (which recommends
// capabilities) and the skill packs / native operations that execute them.

const fs = require('node:fs')
const path = require('node:path')

const { validateRegistry } = require('./schema')

// Default registry path relative to the project root (one level up from src/).
const DEFAULT_REGISTRY_PATH = path.resolve(__dirname, '../../skills/registry.json')

/**
 * @typedef {object} ResolvedCapability
 * @property {string} provider - provider identifier (e.g. "mattpocock-skills")
 * @property {string} command - command within that provider (e.g. "tdd")
 * @property {number} priority - resolver priority (lower = preferred)
 * @property {string|undefined} when - condition that was satisfied, if any
 */

/**
 * @typedef {object} ResolutionContext
 * @property {Set<string>} [satisfiedConditions] - condition strings currently true
 * @property {Set<string>} [availableProviders] - providers known to be available
 */

/**
 * Load and validate a registry file. Throws on missing file or invalid content.
 * @param {string} [registryPath] absolute path, defaults to skills/registry.json
 * @returns {object} validated registry document
 */
function loadRegistry(registryPath = DEFAULT_REGISTRY_PATH) {
  let raw
  try {
    raw = fs.readFileSync(registryPath, 'utf8')
  }
  catch (err) {
    if (err.code === 'ENOENT')
      throw new Error(`registry file not found: ${registryPath}`)
    throw err
  }

  let doc
  try {
    doc = JSON.parse(raw)
  }
  catch (err) {
    throw new Error(`registry file is not valid JSON: ${err.message}`)
  }

  return validateRegistry(doc)
}

/**
 * Determine whether a provider is considered available.
 *
 * - Required providers are assumed available (their absence is a setup error,
 *   not a runtime resolution concern).
 * - Optional providers are available only if explicitly listed in context or
 *   if their `when` condition is satisfied.
 *
 * @param {object} providerDef provider definition from the registry
 * @param {string} providerId provider identifier
 * @param {ResolutionContext} context
 * @returns {boolean}
 */
function isProviderAvailable(providerDef, providerId, context) {
  // Explicitly listed as available — always trust
  if (context.availableProviders && context.availableProviders.has(providerId))
    return true

  // Required providers are assumed present (fail-open for resolution;
  // actual availability is a setup/install concern, not a routing concern).
  if (providerDef.required)
    return true

  // Optional provider with a condition: available if that condition is satisfied
  if (providerDef.when) {
    return !!(context.satisfiedConditions && context.satisfiedConditions.has(providerDef.when))
  }

  // Optional provider without a condition and not explicitly available
  return false
}

/**
 * Check whether a resolver's `when` condition is satisfied in the current context.
 * Resolvers without a `when` clause are unconditionally eligible.
 *
 * @param {object} resolver
 * @param {ResolutionContext} context
 * @returns {boolean}
 */
function isResolverEligible(resolver, context) {
  if (!resolver.when)
    return true
  return !!(context.satisfiedConditions && context.satisfiedConditions.has(resolver.when))
}

/**
 * Resolve a capability name to the best matching provider command.
 *
 * Resolution rules:
 * 1. Resolvers are filtered by provider availability and condition eligibility.
 * 2. Remaining resolvers are sorted by priority (ascending — lower is better).
 * 3. The first resolver wins.
 * 4. Returns null when no resolver qualifies (fail-open: the caller decides
 *    what to do without a resolver).
 *
 * @param {object} registry validated registry document
 * @param {string} capabilityName abstract capability name
 * @param {ResolutionContext} [context]
 * @returns {ResolvedCapability|null}
 */
function resolveCapability(registry, capabilityName, context = {}) {
  const capability = registry.capabilities[capabilityName]
  if (!capability)
    return null

  const eligible = capability.resolvers.filter((resolver) => {
    // Provider must exist in registry and be available
    const providerDef = registry.providers[resolver.provider]
    if (!providerDef)
      return false
    if (!isProviderAvailable(providerDef, resolver.provider, context))
      return false
    // Resolver's own condition must be satisfied
    return isResolverEligible(resolver, context)
  })

  if (eligible.length === 0)
    return null

  // Sort by priority (ascending); stable sort preserves declaration order for ties
  eligible.sort((a, b) => (a.priority ?? Infinity) - (b.priority ?? Infinity))

  const best = eligible[0]
  return {
    provider: best.provider,
    command: best.command,
    priority: best.priority ?? 1,
    when: best.when ?? undefined,
  }
}

/**
 * Resolve all capabilities in the registry and return a map. Useful for
 * diagnostics and the CLI `octowiz capability list` command.
 *
 * @param {object} registry validated registry document
 * @param {ResolutionContext} [context]
 * @returns {Map<string, ResolvedCapability|null>}
 */
function resolveAll(registry, context = {}) {
  const results = new Map()
  for (const name of Object.keys(registry.capabilities)) {
    results.set(name, resolveCapability(registry, name, context))
  }
  return results
}

/**
 * List capability names that have no eligible resolver in the given context.
 * Useful for diagnostics: if a required capability has no resolver, setup is
 * incomplete.
 *
 * @param {object} registry validated registry document
 * @param {ResolutionContext} [context]
 * @returns {string[]} capability names with no resolver
 */
function unresolvedCapabilities(registry, context = {}) {
  const unresolved = []
  for (const name of Object.keys(registry.capabilities)) {
    if (!resolveCapability(registry, name, context))
      unresolved.push(name)
  }
  return unresolved
}

/**
 * Get the list of required providers that should be installed.
 * @param {object} registry validated registry document
 * @returns {{ id: string, install: string }[]}
 */
function requiredProviders(registry) {
  return Object.entries(registry.providers)
    .filter(([, def]) => def.required && def.type === 'skill-pack')
    .map(([id, def]) => ({ id, install: def.install ?? id }))
}

module.exports = {
  DEFAULT_REGISTRY_PATH,
  loadRegistry,
  resolveCapability,
  resolveAll,
  unresolvedCapabilities,
  requiredProviders,
  // Exported for testing internals
  isProviderAvailable,
  isResolverEligible,
}
