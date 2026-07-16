'use strict'

const fs = require('node:fs')

const { LedgerError } = require('../../src/state/errors')
const ledger = require('../../src/state/ledger')
const operations = require('../../src/state/operations')
const store = require('../../src/state/store')
const { makeTempRepo, cleanup } = require('./helpers')

describe('event ledger', () => {
  let repo

  beforeEach(() => {
    repo = makeTempRepo()
  })

  afterEach(() => cleanup(repo))

  it('appends exactly one event per successful mutation', () => {
    store.init(repo)
    store.mutate(repo, doc => operations.setGoal(doc, 'goal one'))
    store.mutate(repo, doc => operations.addCriterion(doc, { statement: 'works', id: 'ac-1' }))

    const events = store.history(repo)
    expect(events.map(e => e.type)).toEqual(['state.initialized', 'goal.updated', 'criterion.added'])
  })

  it('event revisions correspond to snapshot revisions', () => {
    store.init(repo)
    store.mutate(repo, doc => operations.setGoal(doc, 'g1'))
    store.mutate(repo, doc => operations.setGoal(doc, 'g2'))

    const events = store.history(repo)
    expect(events.map(e => e.revision)).toEqual([1, 2, 3])
    expect(store.read(repo).revision).toBe(3)
  })

  it('events carry version, id, timestamp, repository and actor', () => {
    store.init(repo)
    const [event] = store.history(repo)
    expect(event.eventVersion).toBe(ledger.EVENT_VERSION)
    expect(event.eventId).toMatch(/^[0-9a-f-]{36}$/)
    expect(Date.parse(event.timestamp)).not.toBeNaN()
    expect(event.repositoryId).toBeTruthy()
    expect(event.actor).toEqual(ledger.DEFAULT_ACTOR)
  })

  it('refuses unknown event types', () => {
    expect(() => ledger.buildEvent({ type: 'state.hacked', repositoryId: 'x', revision: 1 }))
      .toThrow(LedgerError)
  })

  it('refuses events containing secrets or local paths', () => {
    expect(() => ledger.buildEvent({
      type: 'evidence.recorded',
      repositoryId: 'github:raelli/x',
      revision: 2,
      payload: { ref: 'token sk-abcdefghijklmnop1234 leaked' },
    })).toThrow(/credential/)

    expect(() => ledger.buildEvent({
      type: 'evidence.recorded',
      repositoryId: 'github:raelli/x',
      revision: 2,
      payload: { ref: 'log at /Users/razu/dev/log.txt' },
    })).toThrow(/machine-local/)
  })

  it('mutations that would persist a local path fail before touching disk', () => {
    store.init(repo)
    const before = store.history(repo).length
    expect(() => store.mutate(repo, doc => operations.setGoal(doc, 'edit /Users/razu/Projects/x')))
      .toThrow(/machine-local/)
    expect(store.history(repo).length).toBe(before)
    expect(store.read(repo).goal).toBeNull()
  })

  it('reports a malformed existing ledger safely without modifying it', () => {
    store.init(repo)
    const { ledgerFile } = store.statePaths(repo)
    fs.appendFileSync(ledgerFile, 'not json at all\n')
    const raw = fs.readFileSync(ledgerFile, 'utf8')

    try {
      store.history(repo)
      throw new Error('should have thrown')
    }
    catch (error) {
      expect(error).toBeInstanceOf(LedgerError)
      expect(error.details.line).toBe(2)
    }
    expect(fs.readFileSync(ledgerFile, 'utf8')).toBe(raw)
  })

  it('history honors the limit option', () => {
    store.init(repo)
    for (let i = 0; i < 5; i += 1)
      store.mutate(repo, doc => operations.setGoal(doc, `g${i}`))
    expect(store.history(repo, { limit: 3 })).toHaveLength(3)
    expect(store.history(repo)).toHaveLength(6)
  })
})
