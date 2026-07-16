'use strict'

// Typed errors for the engineering-state module. Every error carries a stable
// `code` so the CLI and hooks can branch on failure kind without string
// matching, and `details` for structured JSON output.

class StateError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'StateError'
    this.code = code
    this.details = details
  }
}

class ValidationError extends StateError {
  constructor(message, details) {
    super('E_VALIDATION', message, details)
    this.name = 'ValidationError'
  }
}

class RevisionConflictError extends StateError {
  constructor(expected, actual) {
    super('E_REVISION_CONFLICT', `expected revision ${expected} but state is at revision ${actual}`, { expected, actual })
    this.name = 'RevisionConflictError'
  }
}

class TransitionError extends StateError {
  constructor(message, details) {
    super('E_TRANSITION', message, details)
    this.name = 'TransitionError'
  }
}

class GuardError extends StateError {
  constructor(message, details) {
    super('E_GUARD', message, details)
    this.name = 'GuardError'
  }
}

// Parsing/IO failure on an existing state file. The store never overwrites the
// corrupted file automatically; `path` points at the preserved original.
class CorruptStateError extends StateError {
  constructor(path, cause) {
    super('E_CORRUPT', `state file at ${path} could not be parsed: ${cause}`, { path, cause })
    this.name = 'CorruptStateError'
  }
}

class LockError extends StateError {
  constructor(path, holder) {
    super('E_LOCKED', `state is locked by another process (lock file: ${path})`, { path, holder })
    this.name = 'LockError'
  }
}

class MigrationError extends StateError {
  constructor(message, details) {
    super('E_MIGRATION', message, details)
    this.name = 'MigrationError'
  }
}

class LedgerError extends StateError {
  constructor(message, details) {
    super('E_LEDGER', message, details)
    this.name = 'LedgerError'
  }
}

module.exports = {
  StateError,
  ValidationError,
  RevisionConflictError,
  TransitionError,
  GuardError,
  CorruptStateError,
  LockError,
  MigrationError,
  LedgerError,
}
