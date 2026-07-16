'use strict'

const fs = require('node:fs')
const path = require('node:path')

const {
  CorruptStateError,
  RevisionConflictError,
  LedgerError,
} = require('../../src/state/errors')
const operations = require('../../src/state/operations')
const store = require('../../src/state/store')
const { makeTempRepo, cleanup } = require('./helpers')

describe('state store', () => {
  let repo

  beforeEach(() => {
    repo = makeTempRepo()
  })

  afterEach(() => {
    jest.restoreAllMocks()
    cleanup(repo)
  })

  describe('init', () => {
    it('initializes a new repository with a valid schema and first ledger event', () => {
      const doc = store.init(repo, { now: '2026-07-16T00:00:00.000Z' })
      expect(doc.revision).toBe(1)
      expect(doc.repository.id).toBe(`local:${path.basename(repo)}`)

      const events = store.history(repo)
      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('state.initialized')
      expect(events[0].revision).toBe(1)
    })

    it('derives a github identity from the origin remote', () => {
      const { execFileSync } = require('node:child_process')
      execFileSync('git', ['-C', repo, 'remote', 'add', 'origin', 'git@github.com:raelli/octowiz-v1.1.git'])
      const doc = store.init(repo)
      expect(doc.repository.id).toBe('github:raelli/octowiz-v1.1')
    })

    it('refuses to overwrite an existing valid state without force', () => {
      store.init(repo)
      expect(() => store.init(repo)).toThrow(/already exists/)
      expect(store.init(repo, { force: true }).revision).toBe(1)
    })

    it('reports an invalid existing state instead of silently replacing it', () => {
      store.init(repo)
      const { stateFile } = store.statePaths(repo)
      fs.writeFileSync(stateFile, '{ not json')
      expect(() => store.init(repo)).toThrow(/repair/)
      expect(fs.readFileSync(stateFile, 'utf8')).toBe('{ not json')
    })
  })

  describe('read', () => {
    it('validates on every read and reports corruption with the exact path', () => {
      store.init(repo)
      const { stateFile } = store.statePaths(repo)
      fs.writeFileSync(stateFile, 'garbage{')
      try {
        store.read(repo)
        throw new Error('should have thrown')
      }
      catch (error) {
        expect(error).toBeInstanceOf(CorruptStateError)
        expect(error.message).toContain(stateFile)
      }
    })

    it('fails with a clear error when state was never initialized', () => {
      expect(() => store.read(repo)).toThrow(/octowiz state init/)
    })
  })

  describe('atomicity', () => {
    it('an interrupted temp-file write does not corrupt the existing state', () => {
      store.init(repo)
      const before = fs.readFileSync(store.statePaths(repo).stateFile, 'utf8')

      const spy = jest.spyOn(fs, 'writeSync').mockImplementation(() => {
        throw new Error('disk full')
      })
      expect(() => store.mutate(repo, doc => operations.setGoal(doc, 'g'))).toThrow(/disk full/)
      spy.mockRestore()

      expect(fs.readFileSync(store.statePaths(repo).stateFile, 'utf8')).toBe(before)
      expect(store.read(repo).revision).toBe(1)
    })

    it('a rename failure preserves the prior state and cleans the temp file', () => {
      store.init(repo)
      const before = fs.readFileSync(store.statePaths(repo).stateFile, 'utf8')

      const spy = jest.spyOn(fs, 'renameSync').mockImplementation(() => {
        throw new Error('rename exploded')
      })
      expect(() => store.mutate(repo, doc => operations.setGoal(doc, 'g'))).toThrow(/rename exploded/)
      spy.mockRestore()

      expect(fs.readFileSync(store.statePaths(repo).stateFile, 'utf8')).toBe(before)
      const leftovers = fs.readdirSync(store.statePaths(repo).dir).filter(f => f.includes('.tmp-'))
      expect(leftovers).toHaveLength(0)
    })

    it('never leaves partial JSON in state.json across many mutations', () => {
      store.init(repo)
      for (let i = 0; i < 25; i += 1)
        store.mutate(repo, doc => operations.setGoal(doc, `goal ${i}`))
      const doc = store.read(repo)
      expect(doc.revision).toBe(26)
      expect(doc.goal).toBe('goal 24')
    })
  })

  describe('revision conflicts', () => {
    it('accepts a mutation with the correct expected revision', () => {
      store.init(repo)
      const doc = store.mutate(repo, d => operations.setGoal(d, 'g'), { expectedRevision: 1 })
      expect(doc.revision).toBe(2)
    })

    it('rejects a stale expected revision and preserves state', () => {
      store.init(repo)
      store.mutate(repo, d => operations.setGoal(d, 'first'))
      expect(() => store.mutate(repo, d => operations.setGoal(d, 'stale'), { expectedRevision: 1 }))
        .toThrow(RevisionConflictError)
      expect(store.read(repo).goal).toBe('first')
    })

    it('two simulated sessions cannot silently overwrite each other', () => {
      store.init(repo)
      const sessionARead = store.read(repo)
      const sessionBRead = store.read(repo)

      store.mutate(repo, d => operations.setGoal(d, 'session A wins'), { expectedRevision: sessionARead.revision })
      expect(() =>
        store.mutate(repo, d => operations.setGoal(d, 'session B stomps'), { expectedRevision: sessionBRead.revision }),
      ).toThrow(RevisionConflictError)
      expect(store.read(repo).goal).toBe('session A wins')
    })
  })

  describe('ledger coupling', () => {
    it('a failed ledger append rolls the snapshot back and fails the mutation', () => {
      store.init(repo)
      const paths = store.statePaths(repo)
      const before = fs.readFileSync(paths.stateFile, 'utf8')

      // Turn the ledger path into a directory: the append must fail without
      // any mocking, and the mutation must fail as a whole.
      fs.unlinkSync(paths.ledgerFile)
      fs.mkdirSync(paths.ledgerFile)

      expect(() => store.mutate(repo, doc => operations.setGoal(doc, 'g'))).toThrow(LedgerError)
      expect(fs.readFileSync(paths.stateFile, 'utf8')).toBe(before)
      expect(store.read(repo).revision).toBe(1)
    })
  })

  describe('repair and corruption', () => {
    it('backs up the corrupted file before repairing and continues the revision sequence', () => {
      store.init(repo)
      store.mutate(repo, doc => operations.setGoal(doc, 'real work'))
      const paths = store.statePaths(repo)
      fs.writeFileSync(paths.stateFile, 'broken{{{')

      const { doc, backupFile } = store.repair(repo, { now: '2026-07-16T01:00:00.000Z' })

      expect(backupFile).toBeTruthy()
      expect(fs.readFileSync(backupFile, 'utf8')).toBe('broken{{{')
      expect(doc.revision).toBe(3) // events reached revision 2; repair continues at 3
      expect(doc.repository.id).toBe(`local:${path.basename(repo)}`)

      const events = store.history(repo)
      expect(events.at(-1).type).toBe('state.repaired')
    })

    it('repair on a valid state is a no-op', () => {
      store.init(repo)
      const { doc, backupFile } = store.repair(repo)
      expect(backupFile).toBeNull()
      expect(doc.revision).toBe(1)
    })
  })
})
