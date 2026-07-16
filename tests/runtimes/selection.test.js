'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { createMockAdapter } = require('../../src/runtimes/adapter')
const { runRuntime, KNOWN_RUNTIME_IDS } = require('../../src/runtimes/cli')
const { createRegistry } = require('../../src/runtimes/registry')
const {
  readRuntimeConfig,
  writeRuntimeConfig,
  getPreferredRuntime,
  selectFromRegistry,
} = require('../../src/runtimes/selection')

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'octowiz-sel-'))
}

function run(argv, cwd) {
  const out = []
  const err = []
  return runRuntime(argv, { cwd, stdout: l => out.push(l), stderr: l => err.push(l) })
    .then(code => ({ code, stdout: out.join('\n'), stderr: err.join('\n') }))
}

// ──────────────────────────────────────────── selection.js

describe('runtime selection', () => {
  let dir

  beforeEach(() => { dir = makeTempDir() })
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

  describe('readRuntimeConfig', () => {
    it('returns null when no config exists', () => {
      expect(readRuntimeConfig(dir)).toBeNull()
    })

    it('returns null when config has no runtime key', () => {
      fs.mkdirSync(path.join(dir, '.octowiz'), { recursive: true })
      fs.writeFileSync(path.join(dir, '.octowiz', 'config.json'), JSON.stringify({ other: 'data' }))
      expect(readRuntimeConfig(dir)).toBeNull()
    })

    it('returns the runtime config when present', () => {
      fs.mkdirSync(path.join(dir, '.octowiz'), { recursive: true })
      fs.writeFileSync(path.join(dir, '.octowiz', 'config.json'), JSON.stringify({ runtime: { preferred: 'opencode' } }))
      expect(readRuntimeConfig(dir)).toEqual({ preferred: 'opencode' })
    })
  })

  describe('writeRuntimeConfig', () => {
    it('creates config file with runtime preference', () => {
      writeRuntimeConfig(dir, { preferred: 'daytona' })
      const raw = fs.readFileSync(path.join(dir, '.octowiz', 'config.json'), 'utf8')
      const doc = JSON.parse(raw)
      expect(doc.runtime.preferred).toBe('daytona')
    })

    it('preserves other config keys', () => {
      fs.mkdirSync(path.join(dir, '.octowiz'), { recursive: true })
      fs.writeFileSync(path.join(dir, '.octowiz', 'config.json'), JSON.stringify({ other: 'data' }))
      writeRuntimeConfig(dir, { preferred: 'opencode' })
      const raw = fs.readFileSync(path.join(dir, '.octowiz', 'config.json'), 'utf8')
      const doc = JSON.parse(raw)
      expect(doc.other).toBe('data')
      expect(doc.runtime.preferred).toBe('opencode')
    })
  })

  describe('getPreferredRuntime', () => {
    it('returns claude-code as default', () => {
      expect(getPreferredRuntime()).toBe('claude-code')
    })

    it('returns explicit preference over config', () => {
      writeRuntimeConfig(dir, { preferred: 'daytona' })
      expect(getPreferredRuntime({ cwd: dir, preference: 'opencode' })).toBe('opencode')
    })

    it('returns config preference when no explicit preference', () => {
      writeRuntimeConfig(dir, { preferred: 'daytona' })
      expect(getPreferredRuntime({ cwd: dir })).toBe('daytona')
    })

    it('returns default when config has no preference', () => {
      expect(getPreferredRuntime({ cwd: dir })).toBe('claude-code')
    })
  })

  describe('selectFromRegistry', () => {
    it('selects the preferred runtime when available', async () => {
      const registry = createRegistry()
      registry.register(createMockAdapter({ id: 'claude-code', isAvailable: async () => true }))
      registry.register(createMockAdapter({ id: 'opencode', isAvailable: async () => true }))

      writeRuntimeConfig(dir, { preferred: 'opencode' })
      const selected = await selectFromRegistry(registry, { cwd: dir })
      expect(selected.id).toBe('opencode')
    })

    it('falls back when preferred is unavailable', async () => {
      const registry = createRegistry()
      registry.register(createMockAdapter({ id: 'claude-code', isAvailable: async () => true }))
      registry.register(createMockAdapter({ id: 'opencode', isAvailable: async () => false }))

      writeRuntimeConfig(dir, { preferred: 'opencode' })
      const selected = await selectFromRegistry(registry, { cwd: dir })
      expect(selected.id).toBe('claude-code')
    })

    it('uses claude-code default when no config', async () => {
      const registry = createRegistry()
      registry.register(createMockAdapter({ id: 'claude-code', isAvailable: async () => true }))
      registry.register(createMockAdapter({ id: 'opencode', isAvailable: async () => true }))

      const selected = await selectFromRegistry(registry, { cwd: dir })
      expect(selected.id).toBe('claude-code')
    })

    it('returns null when nothing is available', async () => {
      const registry = createRegistry()
      registry.register(createMockAdapter({ id: 'claude-code', isAvailable: async () => false }))

      const selected = await selectFromRegistry(registry, { cwd: dir })
      expect(selected).toBeNull()
    })
  })
})

// ──────────────────────────────────────────── CLI

describe('runtime CLI', () => {
  let dir

  beforeEach(() => { dir = makeTempDir() })
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

  describe('show', () => {
    it('shows default preference when no config', async () => {
      const result = await run(['show'], dir)
      expect(result.code).toBe(0)
      expect(result.stdout).toContain('claude-code')
      expect(result.stdout).toContain('default')
    })

    it('shows configured preference', async () => {
      writeRuntimeConfig(dir, { preferred: 'opencode' })
      const result = await run(['show', '--json'], dir)
      expect(result.code).toBe(0)
      const data = JSON.parse(result.stdout)
      expect(data.preferred).toBe('opencode')
      expect(data.configured).toBe('opencode')
    })
  })

  describe('select', () => {
    it('sets the preferred runtime', async () => {
      const result = await run(['select', 'opencode'], dir)
      expect(result.code).toBe(0)
      expect(result.stdout).toContain('opencode')
      expect(readRuntimeConfig(dir).preferred).toBe('opencode')
    })

    it('rejects unknown runtime', async () => {
      const result = await run(['select', 'unknown-runtime'], dir)
      expect(result.code).toBe(1)
      expect(result.stderr).toContain('unknown runtime')
    })

    it('errors without an id', async () => {
      const result = await run(['select'], dir)
      expect(result.code).toBe(1)
      expect(result.stderr).toContain('requires a runtime id')
    })

    it('outputs JSON error format', async () => {
      const result = await run(['select', '--json'], dir)
      expect(result.code).toBe(1)
      expect(JSON.parse(result.stderr).error.code).toBe('E_USAGE')
    })
  })

  describe('list', () => {
    it('lists all known runtimes', async () => {
      const result = await run(['list', '--json'], dir)
      expect(result.code).toBe(0)
      const data = JSON.parse(result.stdout)
      expect(data.map(r => r.id).sort()).toEqual(['claude-code', 'daytona', 'opencode'])
    })

    it('marks the preferred runtime', async () => {
      writeRuntimeConfig(dir, { preferred: 'daytona' })
      const result = await run(['list', '--json'], dir)
      const data = JSON.parse(result.stdout)
      expect(data.find(r => r.id === 'daytona').preferred).toBe(true)
      expect(data.find(r => r.id === 'claude-code').preferred).toBe(false)
    })
  })

  describe('routing', () => {
    it('shows usage with no arguments', async () => {
      const result = await run([], dir)
      expect(result.code).toBe(1)
      expect(result.stdout).toContain('usage: octowiz runtime')
    })

    it('shows usage with help', async () => {
      const result = await run(['help'], dir)
      expect(result.code).toBe(0)
    })

    it('errors on unknown command', async () => {
      const result = await run(['frobnicate'], dir)
      expect(result.code).toBe(1)
      expect(result.stderr).toContain('unknown runtime command')
    })
  })

  it('exports known runtime ids including expected runtimes', () => {
    expect(KNOWN_RUNTIME_IDS).toContain('claude-code')
    expect(KNOWN_RUNTIME_IDS).toContain('opencode')
    expect(KNOWN_RUNTIME_IDS).toContain('daytona')
  })
})
