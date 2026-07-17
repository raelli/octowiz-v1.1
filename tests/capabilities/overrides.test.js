'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { runCapability } = require('../../src/capabilities/cli')
const {
  loadLocalOverrides,
  loadRegistryWithOverrides,
  mergeLocalOverrides,
  loadRegistry,
  resolveCapability,
} = require('../../src/capabilities/registry')
const { validateLocalOverrides } = require('../../src/capabilities/schema')

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'octowiz-overrides-'))
}

function writeOverrides(dir, doc) {
  const octowizDir = path.join(dir, '.octowiz')
  fs.mkdirSync(octowizDir, { recursive: true })
  fs.writeFileSync(path.join(octowizDir, 'capabilities.json'), JSON.stringify(doc, null, 2))
  return path.join(octowizDir, 'capabilities.json')
}

function run(argv, cwd) {
  const out = []
  const err = []
  const code = runCapability(argv, { cwd, stdout: l => out.push(l), stderr: l => err.push(l) })
  return { code, stdout: out.join('\n'), stderr: err.join('\n') }
}

describe('local override schema validation', () => {
  it('accepts a minimal valid override', () => {
    const doc = {
      schemaVersion: '0.1',
      capabilities: {
        implementation: {
          resolvers: [
            { provider: 'my-local-pack', command: 'code', priority: 1 },
          ],
        },
      },
    }
    expect(validateLocalOverrides(doc)).toBe(doc)
  })

  it('accepts overrides with optional providers section', () => {
    const doc = {
      schemaVersion: '0.1',
      providers: {
        'my-local-pack': { type: 'skill-pack', required: false },
      },
      capabilities: {
        implementation: {
          resolvers: [
            { provider: 'my-local-pack', command: 'code', priority: 1 },
          ],
        },
      },
    }
    expect(validateLocalOverrides(doc)).toBe(doc)
  })

  it('accepts mode field with prepend or replace values', () => {
    const doc = {
      schemaVersion: '0.1',
      capabilities: {
        implementation: {
          mode: 'replace',
          resolvers: [{ provider: 'x', command: 'y', priority: 1 }],
        },
        diagnosis: {
          mode: 'prepend',
          resolvers: [{ provider: 'x', command: 'z', priority: 1 }],
        },
      },
    }
    expect(validateLocalOverrides(doc)).toBe(doc)
  })

  it('rejects invalid mode', () => {
    const doc = {
      schemaVersion: '0.1',
      capabilities: {
        implementation: {
          mode: 'append',
          resolvers: [{ provider: 'x', command: 'y', priority: 1 }],
        },
      },
    }
    expect(() => validateLocalOverrides(doc)).toThrow(/mode/)
  })

  it('rejects wrong schema version', () => {
    const doc = { schemaVersion: '99.0', capabilities: {} }
    expect(() => validateLocalOverrides(doc)).toThrow(/schemaVersion/)
  })

  it('rejects non-object input', () => {
    expect(() => validateLocalOverrides(null)).toThrow()
    expect(() => validateLocalOverrides([])).toThrow()
  })

  it('rejects missing capabilities', () => {
    const doc = { schemaVersion: '0.1' }
    expect(() => validateLocalOverrides(doc)).toThrow(/capabilities/)
  })

  it('allows description to be omitted (inherited from default)', () => {
    const doc = {
      schemaVersion: '0.1',
      capabilities: {
        implementation: {
          resolvers: [{ provider: 'x', command: 'y', priority: 1 }],
        },
      },
    }
    expect(validateLocalOverrides(doc)).toBe(doc)
  })

  it('rejects resolvers with missing provider or command', () => {
    const doc = {
      schemaVersion: '0.1',
      capabilities: {
        test: {
          resolvers: [{ command: 'y', priority: 1 }],
        },
      },
    }
    expect(() => validateLocalOverrides(doc)).toThrow(/provider/)
  })

  it('does not require resolver providers to be in local providers (deferred to merge)', () => {
    const doc = {
      schemaVersion: '0.1',
      capabilities: {
        implementation: {
          resolvers: [{ provider: 'some-unknown', command: 'test', priority: 1 }],
        },
      },
    }
    // Should NOT throw — provider reference check is deferred
    expect(validateLocalOverrides(doc)).toBe(doc)
  })
})

describe('loadLocalOverrides', () => {
  let dir

  beforeEach(() => { dir = makeTempDir() })
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

  it('returns null when file does not exist', () => {
    const result = loadLocalOverrides(path.join(dir, '.octowiz', 'capabilities.json'))
    expect(result).toBeNull()
  })

  it('returns validated document when file exists', () => {
    const overridesPath = writeOverrides(dir, {
      schemaVersion: '0.1',
      capabilities: {
        implementation: {
          resolvers: [{ provider: 'local', command: 'impl', priority: 1 }],
        },
      },
    })
    const result = loadLocalOverrides(overridesPath)
    expect(result.capabilities.implementation.resolvers[0].command).toBe('impl')
  })

  it('throws on invalid JSON', () => {
    const octowizDir = path.join(dir, '.octowiz')
    fs.mkdirSync(octowizDir, { recursive: true })
    fs.writeFileSync(path.join(octowizDir, 'capabilities.json'), '{broken')
    expect(() => loadLocalOverrides(path.join(octowizDir, 'capabilities.json'))).toThrow(/not valid JSON/)
  })

  it('throws on structurally invalid content', () => {
    const overridesPath = writeOverrides(dir, { schemaVersion: '0.1' })
    expect(() => loadLocalOverrides(overridesPath)).toThrow(/capabilities/)
  })
})

describe('mergeLocalOverrides', () => {
  let base

  beforeEach(() => {
    base = loadRegistry()
  })

  it('prepends local resolvers before default by default', () => {
    const overrides = {
      schemaVersion: '0.1',
      capabilities: {
        implementation: {
          resolvers: [{ provider: 'local-pack', command: 'my-tdd', priority: 1 }],
        },
      },
    }
    const merged = mergeLocalOverrides(base, overrides)
    const implResolvers = merged.capabilities.implementation.resolvers
    expect(implResolvers[0]).toEqual({ provider: 'local-pack', command: 'my-tdd', priority: 1 })
    expect(implResolvers[1]).toEqual(base.capabilities.implementation.resolvers[0])
  })

  it('replaces default resolvers when mode is replace', () => {
    const overrides = {
      schemaVersion: '0.1',
      capabilities: {
        implementation: {
          mode: 'replace',
          resolvers: [{ provider: 'local-pack', command: 'custom', priority: 1 }],
        },
      },
    }
    const merged = mergeLocalOverrides(base, overrides)
    expect(merged.capabilities.implementation.resolvers).toEqual([
      { provider: 'local-pack', command: 'custom', priority: 1 },
    ])
  })

  it('adds new capabilities from overrides', () => {
    const overrides = {
      schemaVersion: '0.1',
      capabilities: {
        'custom-capability': {
          description: 'A custom local capability',
          resolvers: [{ provider: 'local-pack', command: 'custom', priority: 1 }],
        },
      },
    }
    const merged = mergeLocalOverrides(base, overrides)
    expect(merged.capabilities['custom-capability']).toBeDefined()
    expect(merged.capabilities['custom-capability'].description).toBe('A custom local capability')
    expect(merged.capabilities['custom-capability'].resolvers).toHaveLength(1)
  })

  it('adds local providers to merged result', () => {
    const overrides = {
      schemaVersion: '0.1',
      providers: {
        'local-pack': { type: 'skill-pack', required: false },
      },
      capabilities: {
        implementation: {
          resolvers: [{ provider: 'local-pack', command: 'impl', priority: 1 }],
        },
      },
    }
    const merged = mergeLocalOverrides(base, overrides)
    expect(merged.providers['local-pack']).toEqual({ type: 'skill-pack', required: false })
    // Default providers still present
    expect(merged.providers['mattpocock-skills']).toBeDefined()
  })

  it('local provider overrides default provider with same id', () => {
    const overrides = {
      schemaVersion: '0.1',
      providers: {
        'mattpocock-skills': { type: 'skill-pack', required: false, install: 'custom-fork' },
      },
      capabilities: {},
    }
    const merged = mergeLocalOverrides(base, overrides)
    expect(merged.providers['mattpocock-skills'].install).toBe('custom-fork')
    expect(merged.providers['mattpocock-skills'].required).toBe(false)
  })

  it('local description overrides default description', () => {
    const overrides = {
      schemaVersion: '0.1',
      capabilities: {
        implementation: {
          description: 'Custom implementation approach',
          resolvers: [{ provider: 'x', command: 'y', priority: 1 }],
        },
      },
    }
    const merged = mergeLocalOverrides(base, overrides)
    expect(merged.capabilities.implementation.description).toBe('Custom implementation approach')
  })

  it('inherits default description when local does not provide one', () => {
    const overrides = {
      schemaVersion: '0.1',
      capabilities: {
        implementation: {
          resolvers: [{ provider: 'x', command: 'y', priority: 1 }],
        },
      },
    }
    const merged = mergeLocalOverrides(base, overrides)
    expect(merged.capabilities.implementation.description).toBe(base.capabilities.implementation.description)
  })

  it('does not mutate the base registry', () => {
    const originalResolverCount = base.capabilities.implementation.resolvers.length
    const overrides = {
      schemaVersion: '0.1',
      capabilities: {
        implementation: {
          resolvers: [{ provider: 'x', command: 'y', priority: 1 }],
        },
      },
    }
    mergeLocalOverrides(base, overrides)
    expect(base.capabilities.implementation.resolvers).toHaveLength(originalResolverCount)
  })

  it('preserves all default capabilities not referenced in overrides', () => {
    const overrides = {
      schemaVersion: '0.1',
      capabilities: {
        implementation: {
          resolvers: [{ provider: 'x', command: 'y', priority: 1 }],
        },
      },
    }
    const merged = mergeLocalOverrides(base, overrides)
    expect(Object.keys(merged.capabilities)).toEqual(expect.arrayContaining(Object.keys(base.capabilities)))
  })
})

describe('loadRegistryWithOverrides', () => {
  let dir

  beforeEach(() => { dir = makeTempDir() })
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

  it('returns base registry when overrides file does not exist', () => {
    const base = loadRegistry()
    const result = loadRegistryWithOverrides({
      overridesPath: path.join(dir, '.octowiz', 'capabilities.json'),
    })
    expect(result.capabilities.implementation.resolvers).toEqual(base.capabilities.implementation.resolvers)
  })

  it('returns merged registry when overrides exist', () => {
    writeOverrides(dir, {
      schemaVersion: '0.1',
      capabilities: {
        implementation: {
          resolvers: [{ provider: 'local-pack', command: 'fast-impl', priority: 1 }],
        },
      },
    })
    const result = loadRegistryWithOverrides({
      overridesPath: path.join(dir, '.octowiz', 'capabilities.json'),
    })
    expect(result.capabilities.implementation.resolvers[0].command).toBe('fast-impl')
  })

  it('returns base registry when no overridesPath given', () => {
    const base = loadRegistry()
    const result = loadRegistryWithOverrides({})
    expect(JSON.stringify(result)).toBe(JSON.stringify(base))
  })
})

describe('local override wins resolution', () => {
  let dir

  beforeEach(() => { dir = makeTempDir() })
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

  it('local prepend resolver wins when it has lower priority', () => {
    writeOverrides(dir, {
      schemaVersion: '0.1',
      providers: {
        'team-skills': { type: 'skill-pack', required: true },
      },
      capabilities: {
        implementation: {
          resolvers: [{ provider: 'team-skills', command: 'team-tdd', priority: 1 }],
        },
      },
    })
    const registry = loadRegistryWithOverrides({
      overridesPath: path.join(dir, '.octowiz', 'capabilities.json'),
    })
    // team-skills is now in providers and marked required, so it's available
    const resolved = resolveCapability(registry, 'implementation', {})
    expect(resolved.provider).toBe('team-skills')
    expect(resolved.command).toBe('team-tdd')
  })

  it('local replace mode removes default resolvers entirely', () => {
    writeOverrides(dir, {
      schemaVersion: '0.1',
      providers: {
        custom: { type: 'builtin', required: true },
      },
      capabilities: {
        'requirements-discovery': {
          mode: 'replace',
          resolvers: [{ provider: 'custom', command: 'discover', priority: 1 }],
        },
      },
    })
    const registry = loadRegistryWithOverrides({
      overridesPath: path.join(dir, '.octowiz', 'capabilities.json'),
    })
    const resolved = resolveCapability(registry, 'requirements-discovery', {})
    expect(resolved.provider).toBe('custom')
    expect(resolved.command).toBe('discover')
    // Verify the old default resolvers are gone
    expect(registry.capabilities['requirements-discovery'].resolvers).toHaveLength(1)
  })

  it('new local capability is resolvable', () => {
    writeOverrides(dir, {
      schemaVersion: '0.1',
      providers: {
        'team-skills': { type: 'skill-pack', required: true },
      },
      capabilities: {
        'security-review': {
          description: 'Review for security vulnerabilities',
          resolvers: [{ provider: 'team-skills', command: 'sec-audit', priority: 1 }],
        },
      },
    })
    const registry = loadRegistryWithOverrides({
      overridesPath: path.join(dir, '.octowiz', 'capabilities.json'),
    })
    const resolved = resolveCapability(registry, 'security-review', {})
    expect(resolved.provider).toBe('team-skills')
    expect(resolved.command).toBe('sec-audit')
  })
})

describe('capability CLI with local overrides', () => {
  let dir

  beforeEach(() => {
    dir = makeTempDir()
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'test' }))
  })

  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

  it('resolve uses local override when present', () => {
    writeOverrides(dir, {
      schemaVersion: '0.1',
      providers: {
        'team-skills': { type: 'skill-pack', required: true },
      },
      capabilities: {
        implementation: {
          resolvers: [{ provider: 'team-skills', command: 'team-impl', priority: 1 }],
        },
      },
    })
    const result = run(['resolve', 'implementation', '--json'], dir)
    expect(result.code).toBe(0)
    const data = JSON.parse(result.stdout)
    expect(data.resolved.provider).toBe('team-skills')
    expect(data.resolved.command).toBe('team-impl')
  })

  it('list shows locally added capability', () => {
    writeOverrides(dir, {
      schemaVersion: '0.1',
      providers: {
        'team-skills': { type: 'skill-pack', required: true },
      },
      capabilities: {
        'security-review': {
          description: 'Sec review',
          resolvers: [{ provider: 'team-skills', command: 'sec-check', priority: 1 }],
        },
      },
    })
    const result = run(['list', '--json'], dir)
    expect(result.code).toBe(0)
    const data = JSON.parse(result.stdout)
    expect(data['security-review']).toEqual({ provider: 'team-skills', command: 'sec-check' })
  })

  it('falls back to default registry when no overrides exist', () => {
    const result = run(['resolve', 'implementation', '--json'], dir)
    expect(result.code).toBe(0)
    const data = JSON.parse(result.stdout)
    expect(data.resolved.provider).toBe('mattpocock-skills')
    expect(data.resolved.command).toBe('implement')
  })
})
