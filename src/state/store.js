'use strict'

// Persistence for the repository engineering state. Owns the write contract:
//
//   lock -> read+validate -> check expected revision -> apply mutation ->
//   validate result -> atomic temp+rename snapshot -> append ledger events ->
//   (on append failure: restore previous snapshot bytes) -> unlock
//
// state.json is only ever replaced by a whole-document rename; partial JSON
// can never reach it. Corrupted files are reported and preserved, never
// silently rebuilt — `repair()` is the explicit, backup-first path.

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const {
  CorruptStateError,
  LockError,
  RevisionConflictError,
  StateError,
  ValidationError,
} = require('./errors')
const ledger = require('./ledger')
const { migrate } = require('./migrations')
const { deriveRepositoryId } = require('./repository-id')
const { createInitialState, validateState } = require('./schema')

const STATE_DIRNAME = '.octowiz'
const STATE_FILENAME = 'state.json'
const LEDGER_FILENAME = 'events.jsonl'
const LOCK_FILENAME = 'state.lock'
const LOCK_STALE_MS = 10_000

function statePaths(cwd) {
  const dir = path.join(path.resolve(cwd), STATE_DIRNAME)
  return {
    dir,
    stateFile: path.join(dir, STATE_FILENAME),
    ledgerFile: path.join(dir, LEDGER_FILENAME),
    lockFile: path.join(dir, LOCK_FILENAME),
  }
}

// ---------------------------------------------------------------- writing --

// Whole-document replace: write a temp file in the same directory, fsync it,
// then rename over the destination. Same-directory keeps the rename atomic on
// one filesystem; the temp name is unique per attempt.
function writeAtomic(file, data) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.tmp-${process.pid}-${crypto.randomUUID().slice(0, 8)}`)
  let fd
  try {
    fd = fs.openSync(tmp, 'wx')
    fs.writeSync(fd, data)
    fs.fsyncSync(fd)
    fs.closeSync(fd)
    fd = undefined
    fs.renameSync(tmp, file)
  }
  catch (error) {
    if (fd !== undefined) {
      try { fs.closeSync(fd) }
      catch {}
    }
    try { fs.unlinkSync(tmp) }
    catch {}
    throw error
  }
}

function serialize(doc) {
  return `${JSON.stringify(doc, null, 2)}\n`
}

// ---------------------------------------------------------------- locking --

// Local single-machine lock: create-exclusive lock file, stale after
// LOCK_STALE_MS. Correctness does not depend on the lock alone — revision
// checks and atomic rename are the real guarantees; the lock just narrows the
// read-modify-write race window between cooperating processes.
function acquireLock(lockFile) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, acquiredAt: Date.now() }), { flag: 'wx' })
      return
    }
    catch (error) {
      if (error.code !== 'EEXIST')
        throw error
      let holder = null
      try { holder = JSON.parse(fs.readFileSync(lockFile, 'utf8')) }
      catch {}
      const age = holder?.acquiredAt ? Date.now() - holder.acquiredAt : Number.POSITIVE_INFINITY
      if (age > LOCK_STALE_MS) {
        try { fs.unlinkSync(lockFile) }
        catch {}
        continue
      }
      throw new LockError(lockFile, holder)
    }
  }
  throw new LockError(lockFile, null)
}

function releaseLock(lockFile) {
  try { fs.unlinkSync(lockFile) }
  catch {}
}

// ---------------------------------------------------------------- reading --

function exists(cwd) {
  return fs.existsSync(statePaths(cwd).stateFile)
}

/**
 * Reads, migrates and validates the current state document.
 * @param {string} cwd repository root
 * @returns {object} valid state document
 */
function read(cwd) {
  const { stateFile } = statePaths(cwd)
  if (!fs.existsSync(stateFile))
    throw new StateError('E_NOT_INITIALIZED', `no engineering state at ${stateFile} — run: octowiz state init`, { stateFile })

  const raw = fs.readFileSync(stateFile, 'utf8')
  let parsed
  try {
    parsed = JSON.parse(raw)
  }
  catch (error) {
    throw new CorruptStateError(stateFile, error.message)
  }
  const { doc } = migrate(parsed)
  return validateState(doc)
}

// ------------------------------------------------------------------- init --

/**
 * Creates `.octowiz/` with a fresh valid state and the first ledger event.
 * Refuses to touch an existing state file (valid or not) unless force is set;
 * an invalid existing file is reported, never replaced silently.
 * @param {string} cwd
 * @param {object} [opts]
 * @param {string} [opts.repositoryId] override the derived identity
 * @param {boolean} [opts.force] replace an existing state file
 * @param {string} [opts.now] ISO timestamp override for tests
 * @param {object} [opts.actor]
 * @returns {object} the created state document
 */
function init(cwd, { repositoryId, force = false, now = new Date().toISOString(), actor } = {}) {
  const paths = statePaths(cwd)

  if (fs.existsSync(paths.stateFile) && !force) {
    try {
      const existing = read(cwd)
      throw new StateError(
        'E_ALREADY_INITIALIZED',
        `engineering state already exists at ${paths.stateFile} (revision ${existing.revision}) — pass --force to replace it`,
        { stateFile: paths.stateFile, revision: existing.revision },
      )
    }
    catch (error) {
      if (error instanceof CorruptStateError || error instanceof ValidationError) {
        throw new StateError(
          'E_INVALID_EXISTING',
          `a state file exists at ${paths.stateFile} but is not valid (${error.message}) — run: octowiz state repair`,
          { stateFile: paths.stateFile, cause: error.message },
        )
      }
      throw error
    }
  }

  fs.mkdirSync(paths.dir, { recursive: true })
  const id = repositoryId || deriveRepositoryId(cwd)
  const doc = createInitialState({ repositoryId: id, now })

  acquireLock(paths.lockFile)
  try {
    writeAtomic(paths.stateFile, serialize(doc))
    ledger.appendEvents(paths.ledgerFile, [
      ledger.buildEvent({
        type: 'state.initialized',
        repositoryId: id,
        revision: doc.revision,
        payload: { force },
        actor,
        now,
      }),
    ])
  }
  finally {
    releaseLock(paths.lockFile)
  }
  return doc
}

// --------------------------------------------------------------- mutation --

/**
 * Runs one read-modify-write cycle under the full write contract. `apply`
 * receives a deep copy of the current document and returns
 * `{ doc, events }` where events are `{ type, payload }` descriptors.
 * @param {string} cwd
 * @param {(doc: object) => { doc: object, events: Array<{ type: string, payload?: object }> }} apply
 * @param {object} [opts]
 * @param {number} [opts.expectedRevision] optimistic concurrency check
 * @param {string} [opts.now]
 * @param {object} [opts.actor]
 * @returns {object} the persisted new document
 */
function mutate(cwd, apply, { expectedRevision, now = new Date().toISOString(), actor } = {}) {
  const paths = statePaths(cwd)
  acquireLock(paths.lockFile)
  try {
    const previousRaw = fs.existsSync(paths.stateFile) ? fs.readFileSync(paths.stateFile, 'utf8') : null
    const current = read(cwd)

    if (expectedRevision !== undefined && current.revision !== expectedRevision)
      throw new RevisionConflictError(expectedRevision, current.revision)

    // updatedAt is set before apply() so operations can stamp new items
    // (decisions, evidence, ...) with the same timestamp this mutation gets.
    const working = structuredClone(current)
    working.updatedAt = now
    const { doc: nextDoc, events = [] } = apply(working)
    nextDoc.revision = current.revision + 1
    nextDoc.updatedAt = now
    validateState(nextDoc)

    const built = events.map(e => ledger.buildEvent({
      type: e.type,
      repositoryId: nextDoc.repository.id,
      revision: nextDoc.revision,
      payload: e.payload ?? {},
      actor,
      now,
    }))

    writeAtomic(paths.stateFile, serialize(nextDoc))
    if (built.length > 0) {
      try {
        ledger.appendEvents(paths.ledgerFile, built)
      }
      catch (error) {
        // The mutation must fail as a whole: put the previous snapshot back so
        // snapshot and ledger stay consistent, then surface the ledger error.
        if (previousRaw !== null)
          writeAtomic(paths.stateFile, previousRaw)
        throw error
      }
    }
    return nextDoc
  }
  finally {
    releaseLock(paths.lockFile)
  }
}

// ----------------------------------------------------------------- repair --

/**
 * Explicit recovery from a corrupted or invalid state file. Always backs the
 * broken file up first, then writes a fresh initial state that keeps the
 * repository identity and continues the revision sequence from the ledger.
 * @param {string} cwd
 * @param {object} [opts]
 * @param {string} [opts.now]
 * @param {object} [opts.actor]
 * @returns {{ doc: object, backupFile: string | null }} recovered state and backup location
 */
function repair(cwd, { now = new Date().toISOString(), actor } = {}) {
  const paths = statePaths(cwd)

  try {
    const doc = read(cwd)
    return { doc, backupFile: null } // nothing to repair
  }
  catch (error) {
    if (!(error instanceof CorruptStateError) && !(error instanceof ValidationError))
      throw error
  }

  let backupFile = null
  if (fs.existsSync(paths.stateFile)) {
    backupFile = `${paths.stateFile}.corrupt-${now.replace(/[:.]/g, '-')}.bak`
    fs.copyFileSync(paths.stateFile, backupFile)
  }

  let repositoryId = null
  let lastRevision = 0
  try {
    for (const event of ledger.readEvents(paths.ledgerFile)) {
      if (typeof event.repositoryId === 'string' && event.repositoryId)
        repositoryId = event.repositoryId
      if (Number.isInteger(event.revision))
        lastRevision = Math.max(lastRevision, event.revision)
    }
  }
  catch {
    // A broken ledger must not block snapshot recovery; history() will keep
    // reporting the malformed line.
  }

  const doc = createInitialState({ repositoryId: repositoryId || deriveRepositoryId(cwd), now })
  doc.revision = lastRevision + 1
  fs.mkdirSync(paths.dir, { recursive: true })

  acquireLock(paths.lockFile)
  try {
    writeAtomic(paths.stateFile, serialize(doc))
    try {
      ledger.appendEvents(paths.ledgerFile, [
        ledger.buildEvent({
          type: 'state.repaired',
          repositoryId: doc.repository.id,
          revision: doc.revision,
          payload: { backup: backupFile ? path.basename(backupFile) : null },
          actor,
          now,
        }),
      ])
    }
    catch {
      // Repair is already best-effort recovery; a ledger append failure here
      // must not undo the recovered snapshot.
    }
  }
  finally {
    releaseLock(paths.lockFile)
  }
  return { doc, backupFile }
}

function history(cwd, { limit } = {}) {
  return ledger.readEvents(statePaths(cwd).ledgerFile, { limit })
}

module.exports = {
  STATE_DIRNAME,
  statePaths,
  writeAtomic,
  exists,
  read,
  init,
  mutate,
  repair,
  history,
}
