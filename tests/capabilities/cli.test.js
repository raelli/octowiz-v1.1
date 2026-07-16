'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { runCapability } = require('../../src/capabilities/cli')

function run(argv, cwd) {
  const out = []
  const err = []
  const code = runCapability(argv, { cwd, stdout: l => out.push(l), stderr: l => err.push(l) })
  return { code, stdout: out.join('\n'), stderr: err.join('\n') }
}

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'octowiz-cap-cli-'))
}

describe('octowiz capability CLI', () => {
  let cwd

  beforeEach(() => {
    cwd = makeTempDir()
    // Create a minimal package.json so conditions can evaluate
    fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ name: 'test', scripts: { test: 'jest' } }))
  })

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true })
  })

  describe('resolve', () => {
    it('resolves a known capability', () => {
      const result = run(['resolve', 'implementation'], cwd)
      expect(result.code).toBe(0)
      expect(result.stdout).toContain('mattpocock-skills:tdd')
    })

    it('resolves a known capability with --json', () => {
      const result = run(['resolve', 'implementation', '--json'], cwd)
      expect(result.code).toBe(0)
      const data = JSON.parse(result.stdout)
      expect(data).toEqual({
        capability: 'implementation',
        resolved: { provider: 'mattpocock-skills', command: 'tdd' },
      })
    })

    it('returns null for an unknown capability', () => {
      const result = run(['resolve', 'nonexistent', '--json'], cwd)
      expect(result.code).toBe(0)
      expect(JSON.parse(result.stdout)).toEqual({ capability: 'nonexistent', resolved: null })
    })

    it('returns null for human-decision (no resolvers)', () => {
      const result = run(['resolve', 'human-decision', '--json'], cwd)
      expect(result.code).toBe(0)
      expect(JSON.parse(result.stdout).resolved).toBeNull()
    })

    it('human output indicates unresolved when no resolver qualifies', () => {
      const result = run(['resolve', 'human-decision'], cwd)
      expect(result.code).toBe(0)
      expect(result.stdout).toContain('no resolver qualifies')
    })

    it('errors with exit 1 when name is missing', () => {
      const result = run(['resolve'], cwd)
      expect(result.code).toBe(1)
      expect(result.stderr).toContain('requires a capability name')
    })

    it('errors in JSON format when name is missing with --json', () => {
      const result = run(['resolve', '--json'], cwd)
      expect(result.code).toBe(1)
      expect(JSON.parse(result.stderr).error.code).toBe('E_USAGE')
    })
  })

  describe('list', () => {
    it('lists all capabilities with their resolution', () => {
      const result = run(['list'], cwd)
      expect(result.code).toBe(0)
      expect(result.stdout).toContain('implementation → mattpocock-skills:tdd')
      expect(result.stdout).toContain('human-decision → (unresolved)')
    })

    it('outputs structured JSON with --json', () => {
      const result = run(['list', '--json'], cwd)
      expect(result.code).toBe(0)
      const data = JSON.parse(result.stdout)
      expect(data.implementation).toEqual({ provider: 'mattpocock-skills', command: 'tdd' })
      expect(data['human-decision']).toBeNull()
    })
  })

  describe('routing', () => {
    it('shows usage for unknown commands', () => {
      const result = run(['frobnicate'], cwd)
      expect(result.code).toBe(1)
      expect(result.stderr).toContain('unknown capability command')
    })

    it('shows usage with no arguments', () => {
      const result = run([], cwd)
      expect(result.code).toBe(1)
      expect(result.stdout).toContain('usage: octowiz capability')
    })

    it('shows usage with help', () => {
      const result = run(['help'], cwd)
      expect(result.code).toBe(0)
      expect(result.stdout).toContain('usage: octowiz capability')
    })
  })
})
