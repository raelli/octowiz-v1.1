'use strict'

// Unified Event Protocol — normalizes events from all runtimes into a standard
// envelope. Provides an event bus for downstream consumers (AELLI forwarding,
// ledger append, state transitions) to subscribe to normalized events.
//
// Raw hook events (PostToolUse, UserPromptSubmit, session start/end) are
// converted into OctowizEvent envelopes through normalization functions.

const { EVENT_TYPES, validateEvent, createEvent } = require('./types')

// ──────────────────────────────────────────── Event Bus

/**
 * Create an event bus for runtime events. Listeners receive validated,
 * normalized events. Invalid events are rejected with an error.
 *
 * @returns {EventBus}
 */
function createEventBus() {
  /** @type {Map<string, Set<(event: import('./types').OctowizEvent) => void>>} */
  const listeners = new Map()
  /** @type {Set<(event: import('./types').OctowizEvent) => void>} */
  const wildcardListeners = new Set()

  /**
   * Subscribe to events of a specific type, or all events with '*'.
   * @param {string} type event type or '*' for all
   * @param {(event: import('./types').OctowizEvent) => void} handler
   * @returns {() => void} unsubscribe function
   */
  function on(type, handler) {
    if (type === '*') {
      wildcardListeners.add(handler)
      return () => wildcardListeners.delete(handler)
    }
    if (!listeners.has(type))
      listeners.set(type, new Set())
    listeners.get(type).add(handler)
    return () => listeners.get(type)?.delete(handler)
  }

  /**
   * Emit an event. Validates the envelope before dispatching to listeners.
   * @param {import('./types').OctowizEvent} event
   * @throws {Error} if the event is invalid
   */
  function emit(event) {
    const issues = validateEvent(event)
    if (issues.length > 0)
      throw new Error(`invalid event: ${issues.join('; ')}`)

    const typeListeners = listeners.get(event.type)
    if (typeListeners) {
      for (const handler of typeListeners)
        handler(event)
    }
    for (const handler of wildcardListeners)
      handler(event)
  }

  /**
   * Number of registered listeners (type-specific + wildcard).
   * @returns {number}
   */
  function listenerCount() {
    let count = wildcardListeners.size
    for (const set of listeners.values())
      count += set.size
    return count
  }

  /**
   * Remove all listeners.
   */
  function clear() {
    listeners.clear()
    wildcardListeners.clear()
  }

  return { on, emit, listenerCount, clear }
}

// ──────────────────────────────────────────── Event Normalization

/**
 * Map from Claude Code hook names to OctowizEvent types.
 */
const HOOK_TYPE_MAP = {
  SessionStart: 'session.started',
  SessionEnd: 'session.ended',
  PostToolUse: 'tool.used',
  PreToolUse: 'tool.used',
  UserPromptSubmit: 'prompt.submitted',
  Stop: 'session.ended',
}

/**
 * Normalize a raw Claude Code hook event (PostToolUse, PreToolUse, etc.)
 * into a standard OctowizEvent envelope.
 *
 * @param {string} hookType the hook event name (e.g. 'PostToolUse', 'UserPromptSubmit')
 * @param {object} rawPayload the raw hook payload
 * @param {object} context
 * @param {string} context.sessionId
 * @param {string} [context.repositoryId]
 * @returns {import('./types').OctowizEvent}
 */
function normalizeHookEvent(hookType, rawPayload, context) {
  const type = HOOK_TYPE_MAP[hookType] ?? 'tool.used'
  return createEvent(type, {
    runtime: 'claude-code',
    sessionId: context.sessionId,
    repositoryId: context.repositoryId,
    payload: {
      hookType,
      ...rawPayload,
    },
  })
}

/**
 * Create a normalized session.started event.
 * @param {object} fields
 * @param {string} fields.runtime
 * @param {string} fields.sessionId
 * @param {string} [fields.repositoryId]
 * @param {object} [fields.metadata]
 * @returns {import('./types').OctowizEvent}
 */
function sessionStarted(fields) {
  return createEvent('session.started', {
    runtime: fields.runtime,
    sessionId: fields.sessionId,
    repositoryId: fields.repositoryId,
    payload: { metadata: fields.metadata ?? {} },
  })
}

/**
 * Create a normalized session.ended event.
 * @param {object} fields
 * @param {string} fields.runtime
 * @param {string} fields.sessionId
 * @param {string} [fields.repositoryId]
 * @param {string} [fields.reason]
 * @returns {import('./types').OctowizEvent}
 */
function sessionEnded(fields) {
  return createEvent('session.ended', {
    runtime: fields.runtime,
    sessionId: fields.sessionId,
    repositoryId: fields.repositoryId,
    payload: { reason: fields.reason ?? 'normal' },
  })
}

/**
 * Create a normalized task.dispatched event.
 * @param {object} fields
 * @param {string} fields.runtime
 * @param {string} fields.sessionId
 * @param {string} [fields.repositoryId]
 * @param {string} fields.capability
 * @param {string} fields.provider
 * @param {string} fields.command
 * @param {object} [fields.execution]
 * @returns {import('./types').OctowizEvent}
 */
function taskDispatched(fields) {
  return createEvent('task.dispatched', {
    runtime: fields.runtime,
    sessionId: fields.sessionId,
    repositoryId: fields.repositoryId,
    payload: {
      capability: fields.capability,
      provider: fields.provider,
      command: fields.command,
      execution: fields.execution,
    },
  })
}

/**
 * Create a normalized task.completed event.
 * @param {object} fields
 * @param {string} fields.runtime
 * @param {string} fields.sessionId
 * @param {string} [fields.repositoryId]
 * @param {string} fields.capability
 * @param {'completed'|'failed'|'deferred'|'human-gate'} fields.status
 * @param {string} [fields.summary]
 * @param {object} [fields.execution]
 * @returns {import('./types').OctowizEvent}
 */
function taskCompleted(fields) {
  return createEvent('task.completed', {
    runtime: fields.runtime,
    sessionId: fields.sessionId,
    repositoryId: fields.repositoryId,
    payload: {
      capability: fields.capability,
      status: fields.status,
      summary: fields.summary,
      execution: fields.execution,
    },
  })
}

/**
 * Create a normalized state.changed event.
 * @param {object} fields
 * @param {string} fields.runtime
 * @param {string} fields.sessionId
 * @param {string} [fields.repositoryId]
 * @param {string} fields.from
 * @param {string} fields.to
 * @param {number} [fields.revision]
 * @returns {import('./types').OctowizEvent}
 */
function stateChanged(fields) {
  return createEvent('state.changed', {
    runtime: fields.runtime,
    sessionId: fields.sessionId,
    repositoryId: fields.repositoryId,
    payload: {
      from: fields.from,
      to: fields.to,
      revision: fields.revision,
    },
  })
}

module.exports = {
  // Event bus
  createEventBus,
  // Normalization
  normalizeHookEvent,
  HOOK_TYPE_MAP,
  // Factory helpers
  sessionStarted,
  sessionEnded,
  taskDispatched,
  taskCompleted,
  stateChanged,
  // Re-export for convenience
  EVENT_TYPES,
  validateEvent,
}
