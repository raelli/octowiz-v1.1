'use strict'

const { ValidationError } = require('../../src/state/errors')
const { createInitialState, validateState, portabilityViolation, SCHEMA_VERSION } = require('../../src/state/schema')

const NOW = '2026-07-16T00:00:00.000Z'

function valid() {
  return createInitialState({ repositoryId: 'github:raelli/octowiz-v1.1', now: NOW })
}

describe('state schema', () => {
  it('accepts a freshly created initial state', () => {
    const doc = valid()
    expect(() => validateState(doc)).not.toThrow()
    expect(doc.schemaVersion).toBe(SCHEMA_VERSION)
    expect(doc.state).toBe('explore')
    expect(doc.phase).toBe('A')
    expect(doc.revision).toBe(1)
  })

  it('rejects non-object documents', () => {
    for (const bad of [null, [], 'x', 42])
      expect(() => validateState(bad)).toThrow(ValidationError)
  })

  it('rejects unsupported schema versions with a terminal error', () => {
    const doc = { ...valid(), schemaVersion: '9.9' }
    expect(() => validateState(doc)).toThrow(/unsupported schemaVersion/)
  })

  it('rejects unknown top-level fields', () => {
    const doc = { ...valid(), pid: 1234 }
    expect(() => validateState(doc)).toThrow(/pid: unknown field/)
  })

  it('rejects unknown nested fields', () => {
    const doc = valid()
    doc.repository.localPort = 8764
    expect(() => validateState(doc)).toThrow(/repository\.localPort: unknown field/)
  })

  it('rejects invalid state and phase enums', () => {
    expect(() => validateState({ ...valid(), state: 'cooking' })).toThrow(/\$\.state/)
    expect(() => validateState({ ...valid(), phase: 'E' })).toThrow(/\$\.phase/)
  })

  it('requires blockedFrom to name an active state while blocked', () => {
    const doc = { ...valid(), state: 'blocked', status: 'blocked', phase: 'C' }
    expect(() => validateState(doc)).toThrow(/blockedFrom/)
    expect(() => validateState({ ...doc, blockedFrom: 'implement' })).not.toThrow()
    expect(() => validateState({ ...doc, blockedFrom: 'shipped' })).toThrow(/blockedFrom/)
  })

  it('rejects evidence items with invalid shape', () => {
    const doc = valid()
    doc.evidence.tests.items.push({ id: 'e1', status: 'passed', recordedAt: NOW })
    expect(() => validateState(doc)).toThrow(/evidence\.tests\.items\[0\]\.ref/)
  })

  it('rejects waived evidence without a reason', () => {
    const doc = valid()
    doc.evidence.tests.items.push({ id: 'e1', status: 'waived', ref: 'ci', recordedAt: NOW })
    expect(() => validateState(doc)).toThrow(/waiverReason/)
  })

  it('rejects passed criteria without evidence references', () => {
    const doc = valid()
    doc.acceptanceCriteria.push({
      id: 'ac-1',
      statement: 'works',
      status: 'passed',
      evidenceRefs: [],
      waiverReason: null,
      updatedAt: NOW,
    })
    expect(() => validateState(doc)).toThrow(/evidence reference/)
  })

  it('requires rung and decision for a passed lean gate', () => {
    const doc = valid()
    doc.leanGate.status = 'passed'
    expect(() => validateState(doc)).toThrow(/leanGate/)
  })

  it('collects multiple issues in one error', () => {
    const doc = { ...valid(), state: 'cooking', revision: 0 }
    try {
      validateState(doc)
      throw new Error('should have thrown')
    }
    catch (error) {
      expect(error).toBeInstanceOf(ValidationError)
      expect(error.details.issues.length).toBeGreaterThanOrEqual(2)
    }
  })

  describe('portability rules', () => {
    it('flags machine-local absolute paths', () => {
      expect(portabilityViolation('/Users/razu/Projects/x')).toMatch(/machine-local/)
      expect(portabilityViolation('/home/janis/work')).toMatch(/machine-local/)
      expect(portabilityViolation('C:\\Users\\janis\\x')).toMatch(/machine-local/)
      expect(portabilityViolation('~/secret/place')).toMatch(/machine-local/)
    })

    it('flags credential-shaped strings', () => {
      expect(portabilityViolation('sk-abcdefghijklmnop1234')).toMatch(/credential/)
      expect(portabilityViolation('ghp_0123456789abcdef0123')).toMatch(/credential/)
      expect(portabilityViolation('Bearer abcdef0123456789abcd')).toMatch(/credential/)
    })

    it('accepts ordinary engineering text and repo-relative paths', () => {
      expect(portabilityViolation('reuse the existing lease manager')).toBeNull()
      expect(portabilityViolation('src/state/store.js passes jest')).toBeNull()
      expect(portabilityViolation('https://github.com/raelli/octowiz-v1.1/pull/2')).toBeNull()
    })

    it('rejects goals containing local paths through validateState', () => {
      const doc = { ...valid(), goal: 'fix the thing in /Users/razu/Projects/octowiz' }
      expect(() => validateState(doc)).toThrow(/machine-local/)
    })
  })
})
