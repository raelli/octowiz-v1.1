'use strict'

const fs = require('node:fs')
const path = require('node:path')

const { resolveNextAction } = require('../../src/state/next')
const operations = require('../../src/state/operations')
const store = require('../../src/state/store')
const transitions = require('../../src/state/transitions')
const { makeTempRepo, cleanup, toImplement } = require('./helpers')

describe('state next resolver', () => {
  let repo

  beforeEach(() => {
    repo = makeTempRepo()
  })

  afterEach(() => cleanup(repo))

  it('recommends requirements-discovery without a goal', () => {
    store.init(repo)
    const next = resolveNextAction(store.read(repo))
    expect(next).toMatchObject({ capability: 'requirements-discovery', humanGate: true })
    expect(next.execution.pattern).toBe('advisor')
  })

  it('recommends decision-resolution while blocking questions are open', () => {
    store.init(repo)
    store.mutate(repo, d => operations.setGoal(d, 'g'))
    store.mutate(repo, d => operations.openQuestion(d, { question: 'which db?', blocking: true, id: 'q-1' }))
    const next = resolveNextAction(store.read(repo))
    expect(next.capability).toBe('decision-resolution')
    expect(next.reason).toContain('q-1')
  })

  it('recommends lean-design-check when goal and criteria exist without a gate decision', () => {
    store.init(repo)
    store.mutate(repo, d => operations.setGoal(d, 'g'))
    store.mutate(repo, d => operations.addCriterion(d, { statement: 'works', id: 'ac-1' }))
    expect(resolveNextAction(store.read(repo)).capability).toBe('lean-design-check')
  })

  it('recommends ticket-breakdown once slicing is explicitly requested from plan', () => {
    store.init(repo)
    store.mutate(repo, d => operations.setGoal(d, 'g'))
    store.mutate(repo, d => operations.linkArtifact(d, { type: 'issue', id: 'issue-1' }))
    store.mutate(repo, d => operations.addCriterion(d, { statement: 'works', id: 'ac-1' }))
    store.mutate(repo, d => operations.recordLeanGate(d, { status: 'passed', selectedRung: 'minimal-new-code', decision: 'build it' }))
    store.mutate(repo, d => transitions.transitionTo(d, 'define'))
    store.mutate(repo, d => transitions.transitionTo(d, 'plan'))
    store.mutate(repo, d => transitions.transitionTo(d, 'slice'))
    const next = resolveNextAction(store.read(repo))
    expect(next.capability).toBe('ticket-breakdown')
    expect(next.humanGate).toBe(true)
  })

  describe('in implement', () => {
    function leanPassed(cwd) {
      store.mutate(cwd, d => operations.recordLeanGate(d, {
        status: 'passed',
        selectedRung: 'minimal-new-code',
        decision: 'build it',
      }))
    }

    it('recommends diagnosis when tests are failing', () => {
      toImplement(store, operations, transitions, repo)
      leanPassed(repo)
      store.mutate(repo, d => operations.recordEvidence(d, { kind: 'tests', status: 'failed', ref: 'jest 3 failures' }))
      expect(resolveNextAction(store.read(repo), { cwd: repo }).capability).toBe('diagnosis')
    })

    it('recommends verification when files changed', () => {
      toImplement(store, operations, transitions, repo)
      leanPassed(repo)
      fs.writeFileSync(path.join(repo, 'work.js'), '// change\n')
      expect(resolveNextAction(store.read(repo), { cwd: repo }).capability).toBe('verification')
    })

    it('recommends implementation with a clean tree and passing checks', () => {
      toImplement(store, operations, transitions, repo)
      leanPassed(repo)
      expect(resolveNextAction(store.read(repo), { cwd: repo }).capability).toBe('implementation')
    })
  })

  it('recommends code-review once required evidence passed in verify', () => {
    toImplement(store, operations, transitions, repo)
    store.mutate(repo, d => operations.recordLeanGate(d, { status: 'passed', selectedRung: 'minimal-new-code', decision: 'build' }))
    fs.writeFileSync(path.join(repo, 'work.js'), '// change\n')
    store.mutate(repo, d => transitions.transitionTo(d, 'verify', { cwd: repo }))

    expect(resolveNextAction(store.read(repo), { cwd: repo }).capability).toBe('verification')

    store.mutate(repo, d => operations.recordEvidence(d, { kind: 'tests', status: 'passed', ref: 'jest' }))
    store.mutate(repo, d => operations.recordEvidence(d, { kind: 'lint', status: 'passed', ref: 'eslint' }))
    expect(resolveNextAction(store.read(repo), { cwd: repo }).capability).toBe('code-review')
  })

  it('recommends handoff-or-ship behind a human gate after review passes', () => {
    toImplement(store, operations, transitions, repo)
    store.mutate(repo, d => operations.recordLeanGate(d, { status: 'passed', selectedRung: 'minimal-new-code', decision: 'build' }))
    fs.writeFileSync(path.join(repo, 'work.js'), '// change\n')
    store.mutate(repo, d => transitions.transitionTo(d, 'verify', { cwd: repo }))
    store.mutate(repo, d => operations.recordEvidence(d, { kind: 'tests', status: 'passed', ref: 'jest' }))
    store.mutate(repo, d => operations.recordEvidence(d, { kind: 'lint', status: 'passed', ref: 'eslint' }))
    store.mutate(repo, d => transitions.transitionTo(d, 'review', { cwd: repo }))
    store.mutate(repo, d => operations.recordEvidence(d, { kind: 'review', status: 'passed', ref: 'approved' }))

    const next = resolveNextAction(store.read(repo), { cwd: repo })
    expect(next.capability).toBe('handoff-or-ship')
    expect(next.humanGate).toBe(true)
  })

  it('recommends human-decision while blocked', () => {
    toImplement(store, operations, transitions, repo)
    store.mutate(repo, d => operations.recordLeanGate(d, { status: 'passed', selectedRung: 'minimal-new-code', decision: 'build' }))
    store.mutate(repo, d => transitions.transitionTo(d, 'blocked', { reason: 'tower approval' }))

    const next = resolveNextAction(store.read(repo))
    expect(next.capability).toBe('human-decision')
    expect(next.humanGate).toBe(true)
    expect(next.reason).toContain('implement')
  })

  it('has no recommendation after shipping', () => {
    store.init(repo)
    const doc = store.read(repo)
    doc.state = 'shipped'
    doc.status = 'done'
    expect(resolveNextAction(doc).capability).toBeNull()
  })

  it('selects workflow mode only from explicit safe fan-out metadata', () => {
    store.init(repo)
    const next = resolveNextAction(store.read(repo), {
      executionRequest: {
        pattern: 'workflow',
        partitionable: true,
        scope: 'one worker per route',
        verification: 'cross-check findings',
        maxAgents: 6,
        writes: false,
      },
    })
    expect(next.execution.pattern).toBe('workflow')
  })
})
