'use strict'

// Append-only engineering event ledger (`.octowiz/events.jsonl`). The
// snapshot in state.json is canonical; the ledger exists for audit, debugging
// and future reconstruction. Events are compact — never full conversations,
// source files, or anything the portability rules forbid.

const crypto = require('node:crypto')
const fs = require('node:fs')

const { LedgerError } = require('./errors')
const { portabilityViolation } = require('./schema')

const EVENT_VERSION = '0.1'

const EVENT_TYPES = [
  'state.initialized',
  'state.transitioned',
  'goal.updated',
  'artifact.linked',
  'decision.recorded',
  'question.opened',
  'question.resolved',
  'criterion.added',
  'criterion.updated',
  'lean-gate.recorded',
  'evidence.recorded',
  'review.recorded',
  'state.repaired',
]

const DEFAULT_ACTOR = { type: 'agent', runtime: 'claude-code', sessionId: null }

/**
 * Builds one validated ledger event. Session IDs stay in the machine-local
 * runtime store; the committed ledger keeps actor.sessionId null by default.
 * @param {object} opts
 * @param {string} opts.type one of EVENT_TYPES
 * @param {string} opts.repositoryId
 * @param {number} opts.revision snapshot revision this event produced
 * @param {object} [opts.payload]
 * @param {object} [opts.actor]
 * @param {string} [opts.now] ISO timestamp override for tests
 * @returns {object} the validated event
 */
function buildEvent({ type, repositoryId, revision, payload = {}, actor = DEFAULT_ACTOR, now = new Date().toISOString() }) {
  if (!EVENT_TYPES.includes(type))
    throw new LedgerError(`unknown event type ${JSON.stringify(type)}`, { type })
  const event = {
    eventVersion: EVENT_VERSION,
    eventId: crypto.randomUUID(),
    timestamp: now,
    repositoryId,
    revision,
    type,
    actor,
    payload,
  }
  assertPortable(event)
  return event
}

// Walks every string in the event; a single machine path or credential
// anywhere fails the whole event before it can reach disk.
function assertPortable(value, path = 'event') {
  if (typeof value === 'string') {
    const violation = portabilityViolation(value)
    if (violation)
      throw new LedgerError(`${path} ${violation}`, { path, violation })
    return
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertPortable(v, `${path}[${i}]`))
    return
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value))
      assertPortable(v, `${path}.${k}`)
  }
}

/**
 * Appends events as JSON lines with an fsync. All events of one mutation are
 * written in a single call so they land together or not at all; the store
 * rolls the snapshot back when this throws.
 * @param {string} ledgerFile
 * @param {object[]} events
 */
function appendEvents(ledgerFile, events) {
  const lines = events.map(e => `${JSON.stringify(e)}\n`).join('')
  let fd
  try {
    fd = fs.openSync(ledgerFile, 'a')
    fs.writeSync(fd, lines)
    fs.fsyncSync(fd)
  }
  catch (error) {
    throw new LedgerError(`could not append to ledger at ${ledgerFile}: ${error.message}`, { ledgerFile })
  }
  finally {
    if (fd !== undefined)
      fs.closeSync(fd)
  }
}

/**
 * Reads and parses the ledger. A malformed line raises LedgerError naming the
 * exact line; the file is never modified.
 * @param {string} ledgerFile
 * @param {object} [opts]
 * @param {number} [opts.limit] return only the last N events
 * @returns {object[]} parsed events, oldest first
 */
function readEvents(ledgerFile, { limit } = {}) {
  if (!fs.existsSync(ledgerFile))
    return []
  const raw = fs.readFileSync(ledgerFile, 'utf8')
  const lines = raw.split('\n').filter(line => line.trim().length > 0)
  const events = lines.map((line, i) => {
    try {
      return JSON.parse(line)
    }
    catch (error) {
      throw new LedgerError(
        `ledger at ${ledgerFile} has a malformed entry on line ${i + 1}: ${error.message}`,
        { ledgerFile, line: i + 1 },
      )
    }
  })
  return typeof limit === 'number' ? events.slice(-limit) : events
}

module.exports = {
  EVENT_VERSION,
  EVENT_TYPES,
  DEFAULT_ACTOR,
  buildEvent,
  appendEvents,
  readEvents,
}
