'use strict'

// Validates the structure of a capability registry file (skills/registry.json
// or a repository-local override). Hand-rolled validation, same approach as
// src/state/schema.js — no external schema engine dependency (lean gate:
// standard-library rung).

const { ValidationError } = require('../state/errors')

const REGISTRY_SCHEMA_VERSION = '0.1'

const PROVIDER_TYPES = ['skill-pack', 'builtin']
const ORCHESTRATION_ROLES = ['coordinator', 'worker']

/**
 * Validate a single resolver entry within a capability.
 * @param {Array<string>} issues accumulator
 * @param {string} path JSON path for error messages
 * @param {*} resolver
 * @param {string[]} providerIds known provider identifiers
 */
function checkResolver(issues, path, resolver, providerIds) {
  if (typeof resolver !== 'object' || resolver === null || Array.isArray(resolver)) {
    issues.push(`${path}: must be an object`)
    return
  }

  const allowed = ['provider', 'command', 'priority', 'when', 'role']
  for (const key of Object.keys(resolver)) {
    if (!allowed.includes(key))
      issues.push(`${path}.${key}: unknown field`)
  }

  if (typeof resolver.provider !== 'string' || !resolver.provider.trim())
    issues.push(`${path}.provider: must be a non-empty string`)
  else if (!providerIds.includes(resolver.provider))
    issues.push(`${path}.provider: references unknown provider ${JSON.stringify(resolver.provider)}`)

  if (typeof resolver.command !== 'string' || !resolver.command.trim())
    issues.push(`${path}.command: must be a non-empty string`)

  if (resolver.priority !== undefined) {
    if (!Number.isInteger(resolver.priority) || resolver.priority < 1)
      issues.push(`${path}.priority: must be a positive integer`)
  }

  if (resolver.when !== undefined) {
    if (typeof resolver.when !== 'string' || !resolver.when.trim())
      issues.push(`${path}.when: must be a non-empty string when present`)
  }

  if (resolver.role !== undefined && !ORCHESTRATION_ROLES.includes(resolver.role))
    issues.push(`${path}.role: must be one of ${ORCHESTRATION_ROLES.join(', ')}`)
}

/**
 * Validate a single capability entry.
 * @param {Array<string>} issues accumulator
 * @param {string} path JSON path
 * @param {string} name capability name
 * @param {*} capability
 * @param {string[]} providerIds known provider identifiers
 */
function checkCapability(issues, path, name, capability, providerIds) {
  if (typeof capability !== 'object' || capability === null || Array.isArray(capability)) {
    issues.push(`${path}: must be an object`)
    return
  }

  const allowed = ['description', 'resolvers']
  for (const key of Object.keys(capability)) {
    if (!allowed.includes(key))
      issues.push(`${path}.${key}: unknown field`)
  }

  if (typeof capability.description !== 'string' || !capability.description.trim())
    issues.push(`${path}.description: must be a non-empty string`)

  if (!Array.isArray(capability.resolvers)) {
    issues.push(`${path}.resolvers: must be an array`)
  }
  else {
    capability.resolvers.forEach((r, i) => {
      checkResolver(issues, `${path}.resolvers[${i}]`, r, providerIds)
    })
  }
}

/**
 * Validate a single provider entry.
 * @param {Array<string>} issues accumulator
 * @param {string} path JSON path
 * @param {*} provider
 */
function checkProvider(issues, path, provider) {
  if (typeof provider !== 'object' || provider === null || Array.isArray(provider)) {
    issues.push(`${path}: must be an object`)
    return
  }

  const allowed = ['type', 'required', 'install', 'when', 'roles']
  for (const key of Object.keys(provider)) {
    if (!allowed.includes(key))
      issues.push(`${path}.${key}: unknown field`)
  }

  if (!PROVIDER_TYPES.includes(provider.type))
    issues.push(`${path}.type: must be one of ${PROVIDER_TYPES.join(', ')} (got ${JSON.stringify(provider.type)})`)

  if (typeof provider.required !== 'boolean')
    issues.push(`${path}.required: must be a boolean`)

  if (provider.install !== undefined) {
    if (typeof provider.install !== 'string' || !provider.install.trim())
      issues.push(`${path}.install: must be a non-empty string when present`)
  }

  if (provider.when !== undefined) {
    if (typeof provider.when !== 'string' || !provider.when.trim())
      issues.push(`${path}.when: must be a non-empty string when present`)
  }

  if (provider.roles !== undefined) {
    if (!Array.isArray(provider.roles) || provider.roles.length === 0) {
      issues.push(`${path}.roles: must be a non-empty array when present`)
    }
    else {
      for (const role of provider.roles) {
        if (!ORCHESTRATION_ROLES.includes(role))
          issues.push(`${path}.roles: contains invalid role ${JSON.stringify(role)}`)
      }
    }
  }
}

/**
 * Validates a full registry document. Throws ValidationError listing all
 * problems found; returns the document unchanged when valid.
 * @param {*} doc parsed JSON
 * @returns {object} the document, unchanged
 */
function validateRegistry(doc) {
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc))
    throw new ValidationError('registry must be a JSON object', { issues: ['$: must be an object'] })

  const issues = []

  // -- schema version
  if (doc.schemaVersion !== REGISTRY_SCHEMA_VERSION) {
    throw new ValidationError(
      `unsupported registry schemaVersion ${JSON.stringify(doc.schemaVersion)} (this build supports ${REGISTRY_SCHEMA_VERSION})`,
      { issues: [`$.schemaVersion: unsupported version`] },
    )
  }

  const allowed = ['schemaVersion', 'capabilities', 'providers']
  for (const key of Object.keys(doc)) {
    if (!allowed.includes(key))
      issues.push(`$.${key}: unknown top-level field`)
  }

  // -- providers (validate first so capability resolvers can reference-check)
  if (typeof doc.providers !== 'object' || doc.providers === null || Array.isArray(doc.providers)) {
    issues.push('$.providers: must be an object')
    // Cannot validate capabilities without providers — bail with what we have
    throw new ValidationError(
      `registry is invalid (${issues.length} issue${issues.length === 1 ? '' : 's'}): ${issues.join('; ')}`,
      { issues },
    )
  }

  const providerIds = Object.keys(doc.providers)
  for (const [id, provider] of Object.entries(doc.providers)) {
    checkProvider(issues, `$.providers.${id}`, provider)
  }

  // -- capabilities
  if (typeof doc.capabilities !== 'object' || doc.capabilities === null || Array.isArray(doc.capabilities)) {
    issues.push('$.capabilities: must be an object')
  }
  else {
    for (const [name, capability] of Object.entries(doc.capabilities)) {
      checkCapability(issues, `$.capabilities.${name}`, name, capability, providerIds)
    }
  }

  if (issues.length > 0) {
    throw new ValidationError(
      `registry is invalid (${issues.length} issue${issues.length === 1 ? '' : 's'}): ${issues.join('; ')}`,
      { issues },
    )
  }

  return doc
}

/**
 * Validates a local override document (.octowiz/capabilities.json).
 *
 * Local overrides are a subset of the full registry:
 * - `schemaVersion` (required, must match)
 * - `providers` (optional) — additional providers available locally
 * - `capabilities` (required) — overrides or additions; resolvers reference
 *   providers from either the local doc or the default registry
 *
 * Unlike the full registry, resolvers in a local override can reference
 * providers that will exist in the merged result (from the default registry).
 * We validate structure but defer provider reference checks to merge time.
 *
 * @param {*} doc parsed JSON
 * @returns {object} the document, unchanged
 */
function validateLocalOverrides(doc) {
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc))
    throw new ValidationError('local overrides must be a JSON object', { issues: ['$: must be an object'] })

  const issues = []

  if (doc.schemaVersion !== REGISTRY_SCHEMA_VERSION) {
    throw new ValidationError(
      `unsupported local override schemaVersion ${JSON.stringify(doc.schemaVersion)} (this build supports ${REGISTRY_SCHEMA_VERSION})`,
      { issues: ['$.schemaVersion: unsupported version'] },
    )
  }

  const allowed = ['schemaVersion', 'capabilities', 'providers']
  for (const key of Object.keys(doc)) {
    if (!allowed.includes(key))
      issues.push(`$.${key}: unknown top-level field`)
  }

  // -- providers (optional in local overrides)
  const localProviderIds = []
  if (doc.providers !== undefined) {
    if (typeof doc.providers !== 'object' || doc.providers === null || Array.isArray(doc.providers)) {
      issues.push('$.providers: must be an object when present')
    }
    else {
      for (const [id, provider] of Object.entries(doc.providers)) {
        localProviderIds.push(id)
        checkProvider(issues, `$.providers.${id}`, provider)
      }
    }
  }

  // -- capabilities (required)
  if (typeof doc.capabilities !== 'object' || doc.capabilities === null || Array.isArray(doc.capabilities)) {
    issues.push('$.capabilities: must be an object')
  }
  else {
    for (const [name, capability] of Object.entries(doc.capabilities)) {
      checkLocalCapability(issues, `$.capabilities.${name}`, name, capability)
    }
  }

  if (issues.length > 0) {
    throw new ValidationError(
      `local overrides invalid (${issues.length} issue${issues.length === 1 ? '' : 's'}): ${issues.join('; ')}`,
      { issues },
    )
  }

  return doc
}

/**
 * Validate a capability in a local override. Resolver provider references are
 * not cross-checked against the default registry here — validated at merge time.
 */
function checkLocalCapability(issues, capPath, name, capability) {
  if (typeof capability !== 'object' || capability === null || Array.isArray(capability)) {
    issues.push(`${capPath}: must be an object`)
    return
  }

  const allowed = ['description', 'resolvers', 'mode']
  for (const key of Object.keys(capability)) {
    if (!allowed.includes(key))
      issues.push(`${capPath}.${key}: unknown field`)
  }

  // description is optional in local overrides (inherited from default)
  if (capability.description !== undefined) {
    if (typeof capability.description !== 'string' || !capability.description.trim())
      issues.push(`${capPath}.description: must be a non-empty string when present`)
  }

  if (capability.mode !== undefined) {
    const validModes = ['prepend', 'replace']
    if (!validModes.includes(capability.mode))
      issues.push(`${capPath}.mode: must be one of ${validModes.join(', ')} (got ${JSON.stringify(capability.mode)})`)
  }

  if (!Array.isArray(capability.resolvers)) {
    issues.push(`${capPath}.resolvers: must be an array`)
  }
  else {
    capability.resolvers.forEach((r, i) => {
      checkLocalResolver(issues, `${capPath}.resolvers[${i}]`, r)
    })
  }
}

/**
 * Validate a resolver in a local override. Provider references are NOT
 * checked against the default registry — only structural validity is enforced.
 */
function checkLocalResolver(issues, resolverPath, resolver) {
  if (typeof resolver !== 'object' || resolver === null || Array.isArray(resolver)) {
    issues.push(`${resolverPath}: must be an object`)
    return
  }

  const allowed = ['provider', 'command', 'priority', 'when', 'role']
  for (const key of Object.keys(resolver)) {
    if (!allowed.includes(key))
      issues.push(`${resolverPath}.${key}: unknown field`)
  }

  if (typeof resolver.provider !== 'string' || !resolver.provider.trim())
    issues.push(`${resolverPath}.provider: must be a non-empty string`)

  if (typeof resolver.command !== 'string' || !resolver.command.trim())
    issues.push(`${resolverPath}.command: must be a non-empty string`)

  if (resolver.priority !== undefined) {
    if (!Number.isInteger(resolver.priority) || resolver.priority < 1)
      issues.push(`${resolverPath}.priority: must be a positive integer`)
  }

  if (resolver.when !== undefined) {
    if (typeof resolver.when !== 'string' || !resolver.when.trim())
      issues.push(`${resolverPath}.when: must be a non-empty string when present`)
  }

  if (resolver.role !== undefined && !ORCHESTRATION_ROLES.includes(resolver.role))
    issues.push(`${resolverPath}.role: must be one of ${ORCHESTRATION_ROLES.join(', ')}`)
}

module.exports = {
  REGISTRY_SCHEMA_VERSION,
  PROVIDER_TYPES,
  ORCHESTRATION_ROLES,
  validateRegistry,
  validateLocalOverrides,
}
