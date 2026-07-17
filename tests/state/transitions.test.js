'use strict'

const fs = require('node:fs')
const path = require('node:path')

const { GuardError, TransitionError } = require('../../src/state/errors')
const operations = require('../../src/state/operations')
const store = require('../../src/state/store')
const transitions = require('../../src/state/transitions')
const { makeTempRepo, cleanup, toImplement } = require('./helpers')

function touch(repo, name = 'work.js') {
  fs.writeFileSync(path.join(repo, name), '// change\n')
}

describe('state transitions', () => {
  let repo

  beforeEach(() => {
    repo = makeTempRepo()
  })

  afterEach(() => cleanup(repo))

  it('walks the happy path explore -> shipped', () => {
    toImplement(store, operations, transitions, repo)
    touch(repo)
    store.mutate(repo, doc => transitions.transitionTo(doc, 'verify', { cwd: repo }))
    store.mutate(repo, doc => operations.recordEvidence(doc, { kind: 'tests', status: 'passed', ref: 'jest suite' }))
    store.mutate(repo, doc => operations.recordEvidence(doc, { kind: 'lint', status: 'passed', ref: 'eslint clean' }))
    store.mutate(repo, doc => transitions.transitionTo(doc, 'review', { cwd: repo }))
    store.mutate(repo, doc => operations.recordEvidence(doc, { kind: 'review', status: 'passed', ref: 'PR review approved' }))
    store.mutate(repo, doc => operations.updateCriterion(doc, { id: 'ac-1', status: 'passed', evidenceRef: 'jest suite' }))
    store.mutate(repo, doc => transitions.transitionTo(doc, 'ready-to-ship', { cwd: repo }))
    store.mutate(repo, doc => operations.recordEvidence(doc, { kind: 'ship', status: 'passed', ref: 'merged as PR 2' }))
    const doc = store.mutate(repo, d => transitions.transitionTo(d, 'shipped', { cwd: repo }))

    expect(doc.state).toBe('shipped')
    expect(doc.status).toBe('done')
    expect(doc.phase).toBe('D')
  })

  it('rejects invalid transitions and leaves snapshot and ledger unchanged', () => {
    store.init(repo)
    const eventsBefore = store.history(repo).length

    expect(() => store.mutate(repo, doc => transitions.transitionTo(doc, 'shipped')))
      .toThrow(TransitionError)

    expect(store.read(repo).state).toBe('explore')
    expect(store.read(repo).revision).toBe(1)
    expect(store.history(repo).length).toBe(eventsBefore)
  })

  it('rejects a transition to the current state', () => {
    store.init(repo)
    expect(() => store.mutate(repo, doc => transitions.transitionTo(doc, 'explore')))
      .toThrow(/already/)
  })

  describe('guards', () => {
    it('plan -> implement requires goal, artifact, criterion and no blocking questions', () => {
      store.init(repo)
      store.mutate(repo, doc => transitions.transitionTo(doc, 'define'))
      store.mutate(repo, doc => transitions.transitionTo(doc, 'plan'))

      try {
        store.mutate(repo, doc => transitions.transitionTo(doc, 'implement'))
        throw new Error('should have thrown')
      }
      catch (error) {
        expect(error).toBeInstanceOf(GuardError)
        expect(error.details.failures.join('\n')).toMatch(/goal/)
        expect(error.details.failures.join('\n')).toMatch(/artifact/)
        expect(error.details.failures.join('\n')).toMatch(/criterion/)
      }
      expect(store.read(repo).state).toBe('plan')
    })

    it('plan -> slice -> implement carries the same readiness guard as the direct path', () => {
      store.init(repo)
      store.mutate(repo, doc => transitions.transitionTo(doc, 'define'))
      store.mutate(repo, doc => transitions.transitionTo(doc, 'plan'))
      store.mutate(repo, doc => transitions.transitionTo(doc, 'slice'))

      expect(() => store.mutate(repo, doc => transitions.transitionTo(doc, 'implement')))
        .toThrow(GuardError)

      store.mutate(repo, doc => operations.setGoal(doc, 'g'))
      store.mutate(repo, doc => operations.linkArtifact(doc, { type: 'issue', id: 'issue-1' }))
      store.mutate(repo, doc => operations.addCriterion(doc, { statement: 'works', id: 'ac-1' }))
      const doc = store.mutate(repo, d => transitions.transitionTo(d, 'implement'))
      expect(doc.state).toBe('implement')
    })

    it('plan -> implement is blocked by open blocking questions but not non-blocking ones', () => {
      store.init(repo)
      store.mutate(repo, doc => operations.setGoal(doc, 'g'))
      store.mutate(repo, doc => operations.waiveArtifact(doc, 'experiment, no tracker'))
      store.mutate(repo, doc => operations.addCriterion(doc, { statement: 'works', id: 'ac-1' }))
      store.mutate(repo, doc => operations.openQuestion(doc, { question: 'which port?', blocking: true, id: 'q-1' }))
      store.mutate(repo, doc => operations.openQuestion(doc, { question: 'nice-to-have?', blocking: false, id: 'q-2' }))
      store.mutate(repo, doc => transitions.transitionTo(doc, 'define'))
      store.mutate(repo, doc => transitions.transitionTo(doc, 'plan'))

      expect(() => store.mutate(repo, doc => transitions.transitionTo(doc, 'implement')))
        .toThrow(/q-1/)

      store.mutate(repo, doc => operations.resolveQuestion(doc, { id: 'q-1', answer: 'the default' }))
      const doc = store.mutate(repo, d => transitions.transitionTo(d, 'implement'))
      expect(doc.state).toBe('implement')
    })

    it('implement -> verify requires working-tree changes or an explicit waiver', () => {
      toImplement(store, operations, transitions, repo)

      expect(() => store.mutate(repo, doc => transitions.transitionTo(doc, 'verify', { cwd: repo })))
        .toThrow(GuardError)

      const doc = store.mutate(repo, d => transitions.transitionTo(d, 'verify', {
        cwd: repo,
        waiveActivityCheck: true,
        reason: 'work already committed on the branch',
      }))
      expect(doc.state).toBe('verify')
    })

    it('implement -> verify ignores .octowiz bookkeeping as activity', () => {
      toImplement(store, operations, transitions, repo)
      // Only .octowiz/* is dirty here (state files are untracked) — that must
      // not count as implementation activity.
      expect(transitions.hasWorkingTreeChanges(repo)).toBe(false)
      touch(repo)
      expect(transitions.hasWorkingTreeChanges(repo)).toBe(true)
    })

    it('verify -> review demands passed or waived required checks, waivers need reasons', () => {
      toImplement(store, operations, transitions, repo)
      touch(repo)
      store.mutate(repo, doc => transitions.transitionTo(doc, 'verify', { cwd: repo }))

      expect(() => store.mutate(repo, doc => transitions.transitionTo(doc, 'review', { cwd: repo })))
        .toThrow(/tests evidence/)

      store.mutate(repo, doc => operations.recordEvidence(doc, { kind: 'tests', status: 'passed', ref: 'jest' }))
      store.mutate(repo, doc => operations.recordEvidence(doc, {
        kind: 'lint',
        status: 'waived',
        ref: 'no linter configured',
        waiverReason: 'repository has no lint setup yet',
      }))

      const doc = store.mutate(repo, d => transitions.transitionTo(d, 'review', { cwd: repo }))
      expect(doc.state).toBe('review')
    })

    it('review -> ready-to-ship requires review evidence and settled criteria', () => {
      toImplement(store, operations, transitions, repo)
      touch(repo)
      store.mutate(repo, doc => transitions.transitionTo(doc, 'verify', { cwd: repo }))
      store.mutate(repo, doc => operations.recordEvidence(doc, { kind: 'tests', status: 'passed', ref: 'jest' }))
      store.mutate(repo, doc => operations.recordEvidence(doc, { kind: 'lint', status: 'passed', ref: 'eslint' }))
      store.mutate(repo, doc => transitions.transitionTo(doc, 'review', { cwd: repo }))

      expect(() => store.mutate(repo, doc => transitions.transitionTo(doc, 'ready-to-ship', { cwd: repo })))
        .toThrow(/review evidence|acceptance criteria/)

      store.mutate(repo, doc => operations.recordEvidence(doc, { kind: 'review', status: 'passed', ref: 'approved' }))
      store.mutate(repo, doc => operations.updateCriterion(doc, { id: 'ac-1', status: 'waived', waiverReason: 'covered by integration suite' }))
      const doc = store.mutate(repo, d => transitions.transitionTo(d, 'ready-to-ship', { cwd: repo }))
      expect(doc.state).toBe('ready-to-ship')
    })

    it('ready-to-ship -> shipped requires completion evidence', () => {
      toImplement(store, operations, transitions, repo)
      touch(repo)
      store.mutate(repo, doc => transitions.transitionTo(doc, 'verify', { cwd: repo }))
      store.mutate(repo, doc => operations.recordEvidence(doc, { kind: 'tests', status: 'passed', ref: 'jest' }))
      store.mutate(repo, doc => operations.recordEvidence(doc, { kind: 'lint', status: 'passed', ref: 'eslint' }))
      store.mutate(repo, doc => transitions.transitionTo(doc, 'review', { cwd: repo }))
      store.mutate(repo, doc => operations.recordEvidence(doc, { kind: 'review', status: 'passed', ref: 'approved' }))
      store.mutate(repo, doc => operations.updateCriterion(doc, { id: 'ac-1', status: 'passed', evidenceRef: 'jest' }))
      store.mutate(repo, doc => transitions.transitionTo(doc, 'ready-to-ship', { cwd: repo }))

      expect(() => store.mutate(repo, doc => transitions.transitionTo(doc, 'shipped', { cwd: repo })))
        .toThrow(/completion evidence/)
    })
  })

  describe('blocked', () => {
    it('any active state can block and only return to its previous state', () => {
      toImplement(store, operations, transitions, repo)

      let doc = store.mutate(repo, d => transitions.transitionTo(d, 'blocked', { reason: 'awaiting tower approval' }))
      expect(doc.state).toBe('blocked')
      expect(doc.status).toBe('blocked')
      expect(doc.blockedFrom).toBe('implement')

      expect(() => store.mutate(repo, d => transitions.transitionTo(d, 'review')))
        .toThrow(/previous active state/)

      doc = store.mutate(repo, d => transitions.transitionTo(d, 'implement'))
      expect(doc.state).toBe('implement')
      expect(doc.status).toBe('active')
      expect(doc.blockedFrom).toBeNull()
    })

    it('shipped work cannot be blocked', () => {
      store.init(repo)
      const doc = store.read(repo)
      doc.state = 'shipped'
      expect(() => transitions.transitionTo(doc, 'blocked')).toThrow(TransitionError)
    })
  })
})
