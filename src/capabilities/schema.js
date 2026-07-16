'use strict'

// Validates the structure of a capability registry file (skills/registry.json
// or a repository-local override). Hand-rolled validation, same approach as
// src/state/schema.js — no external schema engine dependency (lean gate:
// standard-library rung).

const { ValidationError } = require('../state/errors')

const REGISTRY_SCHEMA_VERSION = '0.1'

const PROVIDER_TYPES = ['skill-pack', 'builtin']

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

  const allowed = ['provider', 'command', 'priority', 'when']
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

  const allowed = ['type', 'required', 'install', 'when']
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

module.exports = {
  REGISTRY_SCHEMA_VERSION,
  PROVIDER_TYPES,
  validateRegistry,
}
