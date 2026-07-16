'use strict'

const { MigrationError } = require('../../src/state/errors')
const { migrate } = require('../../src/state/migrations')
const { createInitialState, SCHEMA_VERSION } = require('../../src/state/schema')

describe('state migrations', () => {
  it('passes a current-version document through untouched', () => {
    const doc = createInitialState({ repositoryId: 'github:raelli/x', now: '2026-07-16T00:00:00.000Z' })
    const result = migrate(doc)
    expect(result.migrated).toBe(false)
    expect(result.doc).toBe(doc)
  })

  it('refuses to downgrade a document from a newer schema version', () => {
    const doc = { schemaVersion: '2.0' }
    expect(() => migrate(doc)).toThrow(MigrationError)
    expect(() => migrate(doc)).toThrow(/newer than this build/)
  })

  it('fails clearly when no migration path exists', () => {
    expect(() => migrate({ schemaVersion: '0.0' })).toThrow(/no migration path/)
    expect(() => migrate({ schemaVersion: undefined })).toThrow(MigrationError)
  })

  it('applies registered migrations deterministically', () => {
    const table = {
      '0.0': old => ({ ...old, schemaVersion: SCHEMA_VERSION, goal: old.goal ?? null }),
    }
    const legacy = Object.freeze({ schemaVersion: '0.0', repository: { id: 'local:x' } })

    const first = migrate(legacy, table)
    const second = migrate(legacy, table)

    expect(first.migrated).toBe(true)
    expect(first.fromVersion).toBe('0.0')
    expect(first.doc).toEqual(second.doc) // same input -> same output, no clock or environment influence
    expect(first.doc.schemaVersion).toBe(SCHEMA_VERSION)
    expect(legacy.schemaVersion).toBe('0.0') // input untouched
  })

  it('detects migration loops instead of spinning forever', () => {
    const table = { '0.0': doc => ({ ...doc, schemaVersion: '0.0' }) }
    expect(() => migrate({ schemaVersion: '0.0' }, table)).toThrow(/loop/)
  })
})
