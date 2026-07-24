'use strict'

const { ValidationError } = require('../../src/state/errors')
const operations = require('../../src/state/operations')
const { PROTECTED_CONCERNS } = require('../../src/state/schema')
const store = require('../../src/state/store')
const { makeTempRepo, cleanup } = require('./helpers')

describe('lean engineering gate', () => {
  let repo

  beforeEach(() => {
    repo = makeTempRepo()
    store.init(repo)
  })

  afterEach(() => cleanup(repo))

  it('records the selected rung, decision and rejected alternatives', () => {
    const doc = store.mutate(repo, d => operations.recordLeanGate(d, {
      status: 'passed',
      selectedRung: 'reuse-existing-code',
      decision: 'Reuse the existing lease manager',
      rejectedAlternatives: ['new lifecycle framework', 'second daemon manager'],
    }))

    expect(doc.leanGate.status).toBe('passed')
    expect(doc.leanGate.selectedRung).toBe('reuse-existing-code')
    expect(doc.leanGate.rejectedAlternatives).toHaveLength(2)

    const events = store.history(repo)
    expect(events.at(-1).type).toBe('lean-gate.recorded')
    expect(events.at(-1).payload.selectedRung).toBe('reuse-existing-code')
  })

  it('preserves the known ceiling and upgrade trigger', () => {
    const doc = store.mutate(repo, d => operations.recordLeanGate(d, {
      status: 'passed',
      selectedRung: 'standard-library',
      decision: 'hand-rolled validation over a schema engine',
      knownCeiling: 'validation rules beyond structural checks get verbose',
      upgradeTrigger: 'adopt a schema engine when a second schema consumer appears',
    }))
    expect(doc.leanGate.knownCeiling).toMatch(/verbose/)
    expect(doc.leanGate.upgradeTrigger).toMatch(/second schema consumer/)
  })

  it('rejects an unknown rung', () => {
    expect(() => store.mutate(repo, d => operations.recordLeanGate(d, {
      status: 'passed',
      selectedRung: 'just-wing-it',
      decision: 'x',
    }))).toThrow(ValidationError)
  })

  it('protected concerns cannot be waived by the lean gate alone', () => {
    for (const concern of PROTECTED_CONCERNS) {
      expect(() => store.mutate(repo, d => operations.recordLeanGate(d, {
        status: 'passed',
        selectedRung: 'do-nothing',
        decision: 'skip it',
        waives: [concern],
      }))).toThrow(/cannot waive protected concerns/)
    }
    expect(store.read(repo).leanGate.status).toBe('pending')
  })

  it('a failed gate keeps rung empty but records the outcome', () => {
    const doc = store.mutate(repo, d => operations.recordLeanGate(d, {
      status: 'failed',
      decision: 'requirement not satisfiable without new code; redesign first',
    }))
    expect(doc.leanGate.status).toBe('failed')
    expect(doc.leanGate.selectedRung).toBeNull()
  })
})

describe('complexity-reduction review', () => {
  let repo

  beforeEach(() => {
    repo = makeTempRepo()
    store.init(repo)
  })

  afterEach(() => cleanup(repo))

  it('records findings and the removable-lines estimate with a ledger event', () => {
    const doc = store.mutate(repo, d => operations.recordComplexityReview(d, {
      status: 'passed',
      findings: ['src/x.js:L10-40 delete: dead flag path', 'src/y.js:L5 stdlib: hand-rolled deep clone'],
      estimatedLinesRemovable: 42,
    }))
    expect(doc.complexityReview.status).toBe('passed')
    expect(doc.complexityReview.findings).toHaveLength(2)
    expect(doc.complexityReview.estimatedLinesRemovable).toBe(42)

    const events = store.history(repo)
    expect(events.at(-1).type).toBe('complexity-review.recorded')
    expect(events.at(-1).payload).toEqual({ status: 'passed', findings: 2 })
  })

  it('cannot be recorded back to pending', () => {
    expect(() => store.mutate(repo, d => operations.recordComplexityReview(d, {
      status: 'pending',
    }))).toThrow(ValidationError)
  })

  it('rejects blank findings and non-integer line estimates', () => {
    expect(() => store.mutate(repo, d => operations.recordComplexityReview(d, {
      status: 'passed',
      findings: ['  '],
    }))).toThrow(ValidationError)
    expect(() => store.mutate(repo, d => operations.recordComplexityReview(d, {
      status: 'passed',
      estimatedLinesRemovable: 4.2,
    }))).toThrow(ValidationError)
  })
})
