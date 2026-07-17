'use strict'

// Shared types for the runtime adapter protocol. These define the envelopes
// and payloads exchanged between Octowiz core and runtime adapters.
//
// All types are JSDoc-only (no TypeScript) with hand-rolled validation
// matching the project's lean gate decision (standard-library rung).

// ──────────────────────────────────────────── Constants

const TASK_STATUSES = ['completed', 'failed', 'deferred', 'human-gate']

const EVENT_TYPES = [
  'session.started',
  'session.ended',
  'tool.used',
  'prompt.submitted',
  'task.dispatched',
  'task.completed',
  'task.failed',
  'state.changed',
  'evidence.recorded',
]

// ──────────────────────────────────────────── Type definitions (JSDoc only)

/**
 * @typedef {object} TaskEnvelope
 * @property {string} capability - resolved capability name
 * @property {string} command - resolved provider command
 * @property {string} provider - provider identifier
 * @property {object} context - repo state snapshot for the task
 * @property {string} [context.cwd] - repository root
 * @property {string} [context.goal] - current goal
 * @property {string} [context.state] - current engineering state
 * @property {object} [execution] - validated advisor or workflow execution policy
 * @property {object} [options] - runtime-specific overrides
 */

/**
 * @typedef {object} TaskResult
 * @property {'completed'|'failed'|'deferred'|'human-gate'} status
 * @property {object} [evidence] - machine-readable output (test results, lint output, etc.)
 * @property {string} [summary] - human-readable summary of what happened
 * @property {string[]} [artifacts] - file paths or URLs produced
 * @property {string} [error] - error message when status is 'failed'
 */

/**
 * @typedef {object} RuntimeStatus
 * @property {boolean} available - is the runtime reachable and operational?
 * @property {number} sessions - number of active sessions
 * @property {number} uptime - seconds since the runtime started
 * @property {object} [metadata] - runtime-specific additional info
 */

/**
 * @typedef {object} OctowizEvent
 * @property {string} type - event type from EVENT_TYPES
 * @property {string} runtime - runtime id that produced the event
 * @property {string} [sessionId] - session identifier
 * @property {string} [repositoryId] - repository identifier
 * @property {string} timestamp - ISO-8601 timestamp
 * @property {object} payload - event-specific data
 */

// ──────────────────────────────────────────── Validation

/**
 * Validate a TaskEnvelope. Returns issues array (empty = valid).
 * @param {*} envelope
 * @returns {string[]}
 */
function validateTaskEnvelope(envelope) {
  const issues = []

  if (!envelope || typeof envelope !== 'object') {
    issues.push('envelope must be a non-null object')
    return issues
  }

  if (typeof envelope.capability !== 'string' || !envelope.capability.trim())
    issues.push('envelope.capability must be a non-empty string')

  if (typeof envelope.command !== 'string' || !envelope.command.trim())
    issues.push('envelope.command must be a non-empty string')

  if (typeof envelope.provider !== 'string' || !envelope.provider.trim())
    issues.push('envelope.provider must be a non-empty string')

  if (!envelope.context || typeof envelope.context !== 'object')
    issues.push('envelope.context must be an object')
  if (envelope.execution !== undefined) {
    const { validateExecutionPolicy } = require('../execution/policy')
    issues.push(...validateExecutionPolicy(envelope.execution))
  }

  return issues
}

/**
 * Validate a TaskResult. Returns issues array (empty = valid).
 * @param {*} result
 * @returns {string[]}
 */
function validateTaskResult(result) {
  const issues = []

  if (!result || typeof result !== 'object') {
    issues.push('result must be a non-null object')
    return issues
  }

  if (!TASK_STATUSES.includes(result.status))
    issues.push(`result.status must be one of: ${TASK_STATUSES.join(', ')}`)

  if (result.evidence !== undefined && (typeof result.evidence !== 'object' || result.evidence === null))
    issues.push('result.evidence must be an object when present')

  if (result.summary !== undefined && typeof result.summary !== 'string')
    issues.push('result.summary must be a string when present')

  if (result.artifacts !== undefined) {
    if (!Array.isArray(result.artifacts))
      issues.push('result.artifacts must be an array when present')
    else if (result.artifacts.some(a => typeof a !== 'string'))
      issues.push('result.artifacts must contain only strings')
  }

  if (result.error !== undefined && typeof result.error !== 'string')
    issues.push('result.error must be a string when present')

  return issues
}

/**
 * Validate an OctowizEvent. Returns issues array (empty = valid).
 * @param {*} event
 * @returns {string[]}
 */
function validateEvent(event) {
  const issues = []

  if (!event || typeof event !== 'object') {
    issues.push('event must be a non-null object')
    return issues
  }

  if (typeof event.type !== 'string' || !event.type.trim())
    issues.push('event.type must be a non-empty string')
  else if (!EVENT_TYPES.includes(event.type))
    issues.push(`event.type must be one of: ${EVENT_TYPES.join(', ')}`)

  if (typeof event.runtime !== 'string' || !event.runtime.trim())
    issues.push('event.runtime must be a non-empty string')

  if (typeof event.timestamp !== 'string' || !event.timestamp.trim())
    issues.push('event.timestamp must be a non-empty string (ISO-8601)')

  if (!event.payload || typeof event.payload !== 'object')
    issues.push('event.payload must be an object')

  return issues
}

/**
 * Validate a RuntimeStatus. Returns issues array (empty = valid).
 * @param {*} status
 * @returns {string[]}
 */
function validateRuntimeStatus(status) {
  const issues = []

  if (!status || typeof status !== 'object') {
    issues.push('status must be a non-null object')
    return issues
  }

  if (typeof status.available !== 'boolean')
    issues.push('status.available must be a boolean')

  if (typeof status.sessions !== 'number' || !Number.isInteger(status.sessions) || status.sessions < 0)
    issues.push('status.sessions must be a non-negative integer')

  if (typeof status.uptime !== 'number' || status.uptime < 0)
    issues.push('status.uptime must be a non-negative number')

  return issues
}

// ──────────────────────────────────────────── Factory helpers

/**
 * Create a TaskEnvelope with defaults.
 * @param {object} fields
 * @returns {TaskEnvelope}
 */
function createTaskEnvelope(fields) {
  return {
    capability: fields.capability,
    command: fields.command,
    provider: fields.provider,
    context: fields.context || {},
    execution: fields.execution,
    options: fields.options,
  }
}

/**
 * Create a TaskResult.
 * @param {'completed'|'failed'|'deferred'|'human-gate'} status
 * @param {object} [fields]
 * @returns {TaskResult}
 */
function createTaskResult(status, fields = {}) {
  return {
    status,
    evidence: fields.evidence,
    summary: fields.summary,
    artifacts: fields.artifacts,
    error: fields.error,
  }
}

/**
 * Create an OctowizEvent.
 * @param {string} type
 * @param {object} fields
 * @returns {OctowizEvent}
 */
function createEvent(type, fields) {
  return {
    type,
    runtime: fields.runtime,
    sessionId: fields.sessionId,
    repositoryId: fields.repositoryId,
    timestamp: fields.timestamp || new Date().toISOString(),
    payload: fields.payload || {},
  }
}

module.exports = {
  // Constants
  TASK_STATUSES,
  EVENT_TYPES,
  // Validation
  validateTaskEnvelope,
  validateTaskResult,
  validateEvent,
  validateRuntimeStatus,
  // Factories
  createTaskEnvelope,
  createTaskResult,
  createEvent,
}
