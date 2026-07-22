'use strict'

const fs = require('node:fs')
const path = require('node:path')
const {
  loadRegistry,
  resolveCapability,
  resolveAll,
  unresolvedCapabilities,
  requiredProviders,
  isProviderAvailable,
  isResolverEligible,
} = require('../../src/capabilities/registry')
const { validateRegistry } = require('../../src/capabilities/schema')

// ──────────────────────────────────────────────── fixtures

function validRegistry() {
  return {
    schemaVersion: '0.1',
    capabilities: {
      'implementation': {
        description: 'Implementation of a scoped slice',
        resolvers: [
          { provider: 'mattpocock-skills', command: 'implement', priority: 1 },
        ],
      },
      'diagnosis': {
        description: 'Root-cause analysis',
        resolvers: [
          { provider: 'mattpocock-skills', command: 'diagnosing-bugs', priority: 1 },
          { provider: 'antfu-skills', command: 'debug-vue', priority: 2, when: 'vue-nuxt-vite-ecosystem' },
        ],
      },
      'verification': {
        description: 'Run automated checks',
        resolvers: [
          { provider: 'octowiz-native', command: 'verify', priority: 1 },
        ],
      },
      'no-resolvers': {
        description: 'Human-only capability',
        resolvers: [],
      },
    },
    providers: {
      'mattpocock-skills': { type: 'skill-pack', required: true, install: 'mattpocock-skills' },
      'antfu-skills': { type: 'skill-pack', required: false, install: 'antfu-skills', when: 'vue-nuxt-vite-ecosystem' },
      'octowiz-native': { type: 'builtin', required: true },
    },
  }
}

// ──────────────────────────────────────────────── schema validation

describe('capabilities/schema — validateRegistry', () => {
  it('accepts a valid registry', () => {
    const reg = validRegistry()
    expect(validateRegistry(reg)).toBe(reg)
  })

  it('rejects non-object input', () => {
    expect(() => validateRegistry(null)).toThrow(/must be a JSON object/)
    expect(() => validateRegistry([])).toThrow(/must be a JSON object/)
    expect(() => validateRegistry('hi')).toThrow(/must be a JSON object/)
  })

  it('rejects wrong schema version', () => {
    const reg = validRegistry()
    reg.schemaVersion = '9.9'
    expect(() => validateRegistry(reg)).toThrow(/unsupported registry schemaVersion/)
  })

  it('rejects missing providers', () => {
    const reg = validRegistry()
    delete reg.providers
    expect(() => validateRegistry(reg)).toThrow(/must be an object/)
  })

  it('rejects resolver referencing unknown provider', () => {
    const reg = validRegistry()
    reg.capabilities.implementation.resolvers[0].provider = 'ghost'
    expect(() => validateRegistry(reg)).toThrow(/references unknown provider/)
  })

  it('rejects resolver with invalid priority', () => {
    const reg = validRegistry()
    reg.capabilities.implementation.resolvers[0].priority = -1
    expect(() => validateRegistry(reg)).toThrow(/must be a positive integer/)
  })

  it('rejects resolver with empty command', () => {
    const reg = validRegistry()
    reg.capabilities.implementation.resolvers[0].command = ''
    expect(() => validateRegistry(reg)).toThrow(/must be a non-empty string/)
  })

  it('rejects provider with invalid type', () => {
    const reg = validRegistry()
    reg.providers['mattpocock-skills'].type = 'magic'
    expect(() => validateRegistry(reg)).toThrow(/must be one of/)
  })

  it('rejects provider with non-boolean required', () => {
    const reg = validRegistry()
    reg.providers['mattpocock-skills'].required = 'yes'
    expect(() => validateRegistry(reg)).toThrow(/must be a boolean/)
  })

  it('rejects unknown top-level fields', () => {
    const reg = validRegistry()
    reg.extra = 'nope'
    expect(() => validateRegistry(reg)).toThrow(/unknown top-level field/)
  })

  it('rejects unknown fields on resolver', () => {
    const reg = validRegistry()
    reg.capabilities.implementation.resolvers[0].foo = 'bar'
    expect(() => validateRegistry(reg)).toThrow(/unknown field/)
  })

  it('accepts capability with empty resolvers array', () => {
    const reg = validRegistry()
    expect(validateRegistry(reg).capabilities['no-resolvers'].resolvers).toEqual([])
  })

  it('rejects capability with non-array resolvers', () => {
    const reg = validRegistry()
    reg.capabilities.implementation.resolvers = 'not-an-array'
    expect(() => validateRegistry(reg)).toThrow(/must be an array/)
  })

  it('rejects capability with missing description', () => {
    const reg = validRegistry()
    delete reg.capabilities.implementation.description
    expect(() => validateRegistry(reg)).toThrow(/must be a non-empty string/)
  })
})

// ──────────────────────────────────────────────── loading

describe('capabilities/registry — loadRegistry', () => {
  it('loads and validates the default registry from skills/registry.json', () => {
    const reg = loadRegistry()
    expect(reg.schemaVersion).toBe('0.1')
    expect(reg.capabilities).toBeDefined()
    expect(reg.providers).toBeDefined()
  })

  it('throws on missing file', () => {
    expect(() => loadRegistry('/nonexistent/path.json')).toThrow(/registry file not found/)
  })

  it('throws on invalid JSON', () => {
    const tmpPath = path.join(__dirname, '__tmp_bad_json.json')
    fs.writeFileSync(tmpPath, '{ broken json!!!')
    try {
      expect(() => loadRegistry(tmpPath)).toThrow(/not valid JSON/)
    }
    finally {
      fs.unlinkSync(tmpPath)
    }
  })

  it('throws on valid JSON but invalid registry schema', () => {
    const tmpPath = path.join(__dirname, '__tmp_bad_schema.json')
    fs.writeFileSync(tmpPath, JSON.stringify({ schemaVersion: '0.1', capabilities: {}, providers: 42 }))
    try {
      expect(() => loadRegistry(tmpPath)).toThrow(/must be an object/)
    }
    finally {
      fs.unlinkSync(tmpPath)
    }
  })
})

// ──────────────────────────────────────────────── resolution

describe('capabilities/registry — resolveCapability', () => {
  const reg = validRegistry()

  it('resolves a simple capability to its best resolver', () => {
    const result = resolveCapability(reg, 'implementation')
    expect(result).toEqual({
      provider: 'mattpocock-skills',
      command: 'implement',
      priority: 1,
      when: undefined,
      role: 'worker',
    })
  })

  it('returns null for unknown capability (fail-open)', () => {
    expect(resolveCapability(reg, 'teleportation')).toBeNull()
  })

  it('returns null for capability with no resolvers', () => {
    expect(resolveCapability(reg, 'no-resolvers')).toBeNull()
  })

  it('skips resolver when provider is optional and condition not satisfied', () => {
    // diagnosis has mattpocock (required, priority 1) and antfu (optional, priority 2, when: vue)
    const result = resolveCapability(reg, 'diagnosis', { satisfiedConditions: new Set() })
    expect(result.provider).toBe('mattpocock-skills')
    expect(result.command).toBe('diagnosing-bugs')
  })

  it('includes conditional resolver when condition is satisfied', () => {
    const ctx = { satisfiedConditions: new Set(['vue-nuxt-vite-ecosystem']) }
    const result = resolveCapability(reg, 'diagnosis', ctx)
    // mattpocock has priority 1, so still wins
    expect(result.provider).toBe('mattpocock-skills')
    expect(result.priority).toBe(1)
  })

  it('selects by priority (lower wins)', () => {
    // Create a registry where the conditional resolver has a better priority
    const custom = validRegistry()
    custom.capabilities.diagnosis.resolvers = [
      { provider: 'antfu-skills', command: 'debug-vue', priority: 1, when: 'vue-nuxt-vite-ecosystem' },
      { provider: 'mattpocock-skills', command: 'diagnosing-bugs', priority: 2 },
    ]
    const ctx = { satisfiedConditions: new Set(['vue-nuxt-vite-ecosystem']) }
    const result = resolveCapability(custom, 'diagnosis', ctx)
    expect(result.provider).toBe('antfu-skills')
    expect(result.command).toBe('debug-vue')
  })

  it('falls back to next resolver when preferred is ineligible', () => {
    const custom = validRegistry()
    custom.capabilities.diagnosis.resolvers = [
      { provider: 'antfu-skills', command: 'debug-vue', priority: 1, when: 'vue-nuxt-vite-ecosystem' },
      { provider: 'mattpocock-skills', command: 'diagnosing-bugs', priority: 2 },
    ]
    // No conditions satisfied — antfu is optional and its when is not met
    const result = resolveCapability(custom, 'diagnosis', { satisfiedConditions: new Set() })
    expect(result.provider).toBe('mattpocock-skills')
    expect(result.command).toBe('diagnosing-bugs')
  })

  it('resolver with explicit availableProviders overrides', () => {
    const ctx = { availableProviders: new Set(['antfu-skills']), satisfiedConditions: new Set(['vue-nuxt-vite-ecosystem']) }
    const result = resolveCapability(reg, 'diagnosis', ctx)
    // Both eligible, mattpocock still wins on priority
    expect(result.provider).toBe('mattpocock-skills')
  })
})

// ──────────────────────────────────────────────── bulk resolution

describe('capabilities/registry — resolveAll', () => {
  it('resolves all capabilities in the registry', () => {
    const reg = validRegistry()
    const all = resolveAll(reg)
    expect(all.size).toBe(4)
    expect(all.get('implementation')).not.toBeNull()
    expect(all.get('verification')).not.toBeNull()
    expect(all.get('no-resolvers')).toBeNull()
  })
})

// ──────────────────────────────────────────────── unresolved detection

describe('capabilities/registry — unresolvedCapabilities', () => {
  it('returns capabilities with no eligible resolver', () => {
    const reg = validRegistry()
    const missing = unresolvedCapabilities(reg)
    expect(missing).toContain('no-resolvers')
    expect(missing).not.toContain('implementation')
  })

  it('returns empty when all capabilities resolve', () => {
    const reg = validRegistry()
    delete reg.capabilities['no-resolvers']
    expect(unresolvedCapabilities(reg)).toEqual([])
  })
})

// ──────────────────────────────────────────────── required providers

describe('capabilities/registry — requiredProviders', () => {
  it('lists required skill-pack providers', () => {
    const reg = validRegistry()
    const required = requiredProviders(reg)
    expect(required).toEqual([
      { id: 'mattpocock-skills', install: 'mattpocock-skills' },
    ])
  })

  it('excludes builtin and optional providers', () => {
    const reg = validRegistry()
    const ids = requiredProviders(reg).map(p => p.id)
    expect(ids).not.toContain('octowiz-native')
    expect(ids).not.toContain('antfu-skills')
  })
})

// ──────────────────────────────────────────────── internal helpers

describe('capabilities/registry — isProviderAvailable', () => {
  it('required provider is always available', () => {
    const def = { type: 'skill-pack', required: true }
    expect(isProviderAvailable(def, 'x', {})).toBe(true)
  })

  it('optional provider without condition is unavailable by default', () => {
    const def = { type: 'skill-pack', required: false }
    expect(isProviderAvailable(def, 'x', {})).toBe(false)
  })

  it('optional provider is available when explicitly listed', () => {
    const def = { type: 'skill-pack', required: false }
    expect(isProviderAvailable(def, 'x', { availableProviders: new Set(['x']) })).toBe(true)
  })

  it('optional provider with satisfied condition is available', () => {
    const def = { type: 'skill-pack', required: false, when: 'vue-nuxt-vite-ecosystem' }
    expect(isProviderAvailable(def, 'x', { satisfiedConditions: new Set(['vue-nuxt-vite-ecosystem']) })).toBe(true)
  })

  it('optional provider with unsatisfied condition is unavailable', () => {
    const def = { type: 'skill-pack', required: false, when: 'vue-nuxt-vite-ecosystem' }
    expect(isProviderAvailable(def, 'x', { satisfiedConditions: new Set() })).toBe(false)
  })
})

describe('capabilities/registry — isResolverEligible', () => {
  it('resolver without when is always eligible', () => {
    expect(isResolverEligible({ provider: 'x', command: 'y' }, {})).toBe(true)
  })

  it('resolver with satisfied when is eligible', () => {
    expect(isResolverEligible({ provider: 'x', command: 'y', when: 'docs-exist' }, { satisfiedConditions: new Set(['docs-exist']) })).toBe(true)
  })

  it('resolver with unsatisfied when is ineligible', () => {
    expect(isResolverEligible({ provider: 'x', command: 'y', when: 'docs-exist' }, { satisfiedConditions: new Set() })).toBe(false)
  })
})

// ──────────────────────────────────────────────── default registry coverage

describe('capabilities/registry — default skills/registry.json', () => {
  let reg

  beforeAll(() => {
    reg = loadRegistry()
  })

  it('contains all capabilities referenced by src/state/next.js', () => {
    const expectedCapabilities = [
      'requirements-discovery',
      'plan-validation',
      'definition',
      'ticket-breakdown',
      'decision-resolution',
      'prototype',
      'research',
      'wayfinding',
      'lean-design-check',
      'implementation',
      'test-driven-development',
      'diagnosis',
      'verification',
      'code-review',
      'architecture-review',
      'complexity-review',
      'merge-conflict-resolution',
      'handoff-or-ship',
      'human-decision',
    ]
    for (const cap of expectedCapabilities) {
      expect(reg.capabilities[cap]).toBeDefined()
    }
  })

  it('all resolvers reference valid providers', () => {
    for (const cap of Object.values(reg.capabilities)) {
      for (const resolver of cap.resolvers) {
        expect(reg.providers[resolver.provider]).toBeDefined()
      }
    }
  })

  it('uses only commands shipped by the pinned Matt Pocock provider contract', () => {
    const contractPath = path.resolve(__dirname, '../../skills/provider-contracts/mattpocock-skills.json')
    const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'))
    const shippedCommands = new Set(contract.commands)

    const mattResolvers = Object.entries(reg.capabilities)
      .flatMap(([capability, definition]) => definition.resolvers
        .filter(resolver => resolver.provider === 'mattpocock-skills')
        .map(resolver => ({ capability, command: resolver.command })))

    for (const resolver of mattResolvers)
      expect(shippedCommands.has(resolver.command)).toBe(true)
  })

  it('pins the user-invoked implementation workflow contract', () => {
    const contractPath = path.resolve(__dirname, '../../skills/provider-contracts/mattpocock-skills.json')
    const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'))

    expect(contract.commandContracts.implement).toMatchObject({
      path: 'skills/engineering/implement/SKILL.md',
      blobSha: '7a0b11f5f4fe9505ea5c7983c3083ba1bf754f69',
      disableModelInvocation: true,
      agentPolicies: {
        openai: {
          path: 'skills/engineering/implement/agents/openai.yaml',
          blobSha: 'f8794dc153b409052a9167baf10858cf01b36175',
          allowImplicitInvocation: false,
        },
      },
      input: 'spec-or-tickets',
      usesTddWherePossible: true,
      validation: {
        typecheckRegularly: true,
        focusedTestsRegularly: true,
        fullSuiteOnceAtEnd: true,
      },
      followUp: 'code-review',
      commitsToCurrentBranch: true,
    })
  })

  it('maps core lifecycle capabilities to current Matt Pocock commands', () => {
    const expected = {
      'requirements-discovery': 'grill-with-docs',
      'plan-validation': 'grill-with-docs',
      'definition': 'to-spec',
      'ticket-breakdown': 'to-tickets',
      'decision-resolution': 'grilling',
      'triage': 'triage',
      'implementation': 'implement',
      'diagnosis': 'diagnosing-bugs',
      'code-review': 'code-review',
      'handoff-or-ship': 'handoff',
    }

    for (const [capability, command] of Object.entries(expected))
      expect(resolveCapability(reg, capability)?.command).toBe(command)
  })

  it('does not retain removed pre-1.1 Matt Pocock command names', () => {
    const removedCommands = new Set(['to-prd', 'to-plan', 'to-issues', 'diagnose', 'zoom-out'])
    const commands = Object.values(reg.capabilities)
      .flatMap(capability => capability.resolvers)
      .filter(resolver => resolver.provider === 'mattpocock-skills')
      .map(resolver => resolver.command)

    expect(commands.filter(command => removedCommands.has(command))).toEqual([])
  })

  it('required providers are available and resolve at least one capability', () => {
    const resolved = resolveAll(reg)
    const resolvedCaps = [...resolved.entries()].filter(([, v]) => v !== null)
    // At minimum: implementation, diagnosis, verification, code-review, handoff
    expect(resolvedCaps.length).toBeGreaterThanOrEqual(5)
  })

  it('human-decision capability has no resolvers (by design)', () => {
    expect(reg.capabilities['human-decision'].resolvers).toEqual([])
  })

  it('assigns every executable default resolver an explicit CMA role', () => {
    for (const capability of Object.values(reg.capabilities)) {
      for (const resolver of capability.resolvers)
        expect(['coordinator', 'worker']).toContain(resolver.role)
    }
  })

  it('restricts Antfu to workers while Matt and Octowiz span their declared roles', () => {
    expect(reg.providers['antfu-skills'].roles).toEqual(['worker'])
    expect(reg.providers['mattpocock-skills'].roles).toEqual(['coordinator', 'worker'])
    expect(reg.providers['octowiz-native'].roles).toEqual(['coordinator', 'worker'])
  })
})
