'use strict'

const { createMockAdapter, validateAdapter, assertValidAdapter, REQUIRED_FIELDS } = require('../../src/runtimes/adapter')
const { createRegistry } = require('../../src/runtimes/registry')
const {
  TASK_STATUSES,
  EVENT_TYPES,
  validateTaskEnvelope,
  validateTaskResult,
  validateEvent,
  validateRuntimeStatus,
  createTaskEnvelope,
  createTaskResult,
  createEvent,
} = require('../../src/runtimes/types')

// ──────────────────────────────────────────── adapter.js

describe('runtimeAdapter interface', () => {
  describe('validateAdapter', () => {
    it('returns no issues for a valid adapter', () => {
      const adapter = createMockAdapter()
      expect(validateAdapter(adapter)).toEqual([])
    })

    it('rejects null', () => {
      expect(validateAdapter(null)).toContainEqual(expect.stringContaining('non-null object'))
    })

    it('rejects non-object', () => {
      expect(validateAdapter('string')).toContainEqual(expect.stringContaining('non-null object'))
    })

    it('reports missing id', () => {
      const adapter = createMockAdapter({ id: '' })
      expect(validateAdapter(adapter)).toContainEqual(expect.stringContaining('id'))
    })

    it('reports missing name', () => {
      const adapter = createMockAdapter({ name: '' })
      expect(validateAdapter(adapter)).toContainEqual(expect.stringContaining('name'))
    })

    it('reports non-function isAvailable', () => {
      const adapter = { ...createMockAdapter(), isAvailable: 'not-a-fn' }
      expect(validateAdapter(adapter)).toContainEqual(expect.stringContaining('isAvailable'))
    })

    it('reports non-function dispatch', () => {
      const adapter = { ...createMockAdapter(), dispatch: null }
      expect(validateAdapter(adapter)).toContainEqual(expect.stringContaining('dispatch'))
    })

    it('reports non-function status', () => {
      const adapter = { ...createMockAdapter(), status: 42 }
      expect(validateAdapter(adapter)).toContainEqual(expect.stringContaining('status'))
    })

    it('reports non-function notify', () => {
      const adapter = { ...createMockAdapter(), notify: undefined }
      expect(validateAdapter(adapter)).toContainEqual(expect.stringContaining('notify'))
    })

    it('reports multiple issues at once', () => {
      const issues = validateAdapter({})
      expect(issues.length).toBeGreaterThan(1)
    })
  })

  describe('assertValidAdapter', () => {
    it('does not throw for a valid adapter', () => {
      expect(() => assertValidAdapter(createMockAdapter())).not.toThrow()
    })

    it('throws with all issues for an invalid adapter', () => {
      expect(() => assertValidAdapter({})).toThrow(/invalid runtime adapter/)
    })
  })

  describe('createMockAdapter', () => {
    it('creates a valid adapter with defaults', () => {
      const adapter = createMockAdapter()
      expect(validateAdapter(adapter)).toEqual([])
      expect(adapter.id).toBe('mock-runtime')
      expect(adapter.name).toBe('Mock Runtime')
    })

    it('allows overriding id and name', () => {
      const adapter = createMockAdapter({ id: 'test', name: 'Test Runtime' })
      expect(adapter.id).toBe('test')
      expect(adapter.name).toBe('Test Runtime')
    })

    it('isAvailable returns true by default', async () => {
      const adapter = createMockAdapter()
      await expect(adapter.isAvailable()).resolves.toBe(true)
    })

    it('dispatch returns completed by default', async () => {
      const adapter = createMockAdapter()
      const result = await adapter.dispatch({})
      expect(result.status).toBe('completed')
    })

    it('status returns available by default', async () => {
      const adapter = createMockAdapter()
      const status = await adapter.status()
      expect(status.available).toBe(true)
    })

    it('allows overriding methods', async () => {
      const adapter = createMockAdapter({
        isAvailable: async () => false,
        dispatch: async () => ({ status: 'failed', error: 'not implemented' }),
      })
      await expect(adapter.isAvailable()).resolves.toBe(false)
      const result = await adapter.dispatch({})
      expect(result.status).toBe('failed')
    })
  })

  it('exports REQUIRED_FIELDS with all interface fields', () => {
    expect(REQUIRED_FIELDS).toEqual(['id', 'name', 'isAvailable', 'dispatch', 'status', 'notify'])
  })
})

// ──────────────────────────────────────────── registry.js

describe('runtimeRegistry', () => {
  let registry

  beforeEach(() => {
    registry = createRegistry()
  })

  describe('register / deregister', () => {
    it('registers a valid adapter', () => {
      registry.register(createMockAdapter({ id: 'a' }))
      expect(registry.size()).toBe(1)
      expect(registry.ids()).toEqual(['a'])
    })

    it('throws when registering an invalid adapter', () => {
      expect(() => registry.register({})).toThrow(/invalid runtime adapter/)
    })

    it('overwrites an existing adapter with the same id', () => {
      registry.register(createMockAdapter({ id: 'a', name: 'First' }))
      registry.register(createMockAdapter({ id: 'a', name: 'Second' }))
      expect(registry.size()).toBe(1)
      expect(registry.get('a').name).toBe('Second')
    })

    it('deregisters by id', () => {
      registry.register(createMockAdapter({ id: 'a' }))
      expect(registry.deregister('a')).toBe(true)
      expect(registry.size()).toBe(0)
    })

    it('deregister returns false for unknown id', () => {
      expect(registry.deregister('nonexistent')).toBe(false)
    })
  })

  describe('get', () => {
    it('returns the adapter by id', () => {
      const adapter = createMockAdapter({ id: 'claude-code' })
      registry.register(adapter)
      expect(registry.get('claude-code')).toBe(adapter)
    })

    it('returns null for unknown id', () => {
      expect(registry.get('unknown')).toBeNull()
    })
  })

  describe('ids / size / clear', () => {
    it('lists all registered ids', () => {
      registry.register(createMockAdapter({ id: 'a' }))
      registry.register(createMockAdapter({ id: 'b' }))
      expect(registry.ids().sort()).toEqual(['a', 'b'])
    })

    it('clear removes all adapters', () => {
      registry.register(createMockAdapter({ id: 'a' }))
      registry.register(createMockAdapter({ id: 'b' }))
      registry.clear()
      expect(registry.size()).toBe(0)
      expect(registry.ids()).toEqual([])
    })
  })

  describe('getAvailableRuntimes', () => {
    it('returns adapters that are available', async () => {
      registry.register(createMockAdapter({ id: 'a', isAvailable: async () => true }))
      registry.register(createMockAdapter({ id: 'b', isAvailable: async () => false }))
      const available = await registry.getAvailableRuntimes()
      expect(available.map(a => a.id)).toEqual(['a'])
    })

    it('returns empty array when no adapters registered', async () => {
      const available = await registry.getAvailableRuntimes()
      expect(available).toEqual([])
    })

    it('returns empty array when all are unavailable', async () => {
      registry.register(createMockAdapter({ id: 'a', isAvailable: async () => false }))
      const available = await registry.getAvailableRuntimes()
      expect(available).toEqual([])
    })

    it('handles adapters that throw from isAvailable', async () => {
      registry.register(createMockAdapter({
        id: 'broken',
        isAvailable: async () => { throw new Error('oops') },
      }))
      registry.register(createMockAdapter({ id: 'good', isAvailable: async () => true }))
      const available = await registry.getAvailableRuntimes()
      expect(available.map(a => a.id)).toEqual(['good'])
    })

    it('times out slow adapters', async () => {
      registry.register(createMockAdapter({
        id: 'slow',
        isAvailable: () => new Promise(resolve => setTimeout(resolve, 200, true)),
      }))
      registry.register(createMockAdapter({ id: 'fast', isAvailable: async () => true }))
      const available = await registry.getAvailableRuntimes({ timeoutMs: 10 })
      expect(available.map(a => a.id)).toEqual(['fast'])
    })
  })

  describe('selectRuntime', () => {
    it('selects preferred runtime when available', async () => {
      registry.register(createMockAdapter({ id: 'a', isAvailable: async () => true }))
      registry.register(createMockAdapter({ id: 'b', isAvailable: async () => true }))
      const selected = await registry.selectRuntime('b')
      expect(selected.id).toBe('b')
    })

    it('falls back when preferred is unavailable', async () => {
      registry.register(createMockAdapter({ id: 'a', isAvailable: async () => true }))
      registry.register(createMockAdapter({ id: 'b', isAvailable: async () => false }))
      const selected = await registry.selectRuntime('b')
      expect(selected.id).toBe('a')
    })

    it('falls back when preferred is not registered', async () => {
      registry.register(createMockAdapter({ id: 'a', isAvailable: async () => true }))
      const selected = await registry.selectRuntime('nonexistent')
      expect(selected.id).toBe('a')
    })

    it('selects first available when no preference', async () => {
      registry.register(createMockAdapter({ id: 'a', isAvailable: async () => false }))
      registry.register(createMockAdapter({ id: 'b', isAvailable: async () => true }))
      const selected = await registry.selectRuntime()
      expect(selected.id).toBe('b')
    })

    it('returns null when nothing is available', async () => {
      registry.register(createMockAdapter({ id: 'a', isAvailable: async () => false }))
      const selected = await registry.selectRuntime()
      expect(selected).toBeNull()
    })

    it('returns null with empty registry', async () => {
      const selected = await registry.selectRuntime()
      expect(selected).toBeNull()
    })

    it('handles preferred adapter that throws', async () => {
      registry.register(createMockAdapter({
        id: 'broken',
        isAvailable: async () => { throw new Error('crash') },
      }))
      registry.register(createMockAdapter({ id: 'good', isAvailable: async () => true }))
      const selected = await registry.selectRuntime('broken')
      expect(selected.id).toBe('good')
    })
  })
})

// ──────────────────────────────────────────── types.js

describe('runtime types', () => {
  describe('constants', () => {
    it('includes expected task status values', () => {
      expect(TASK_STATUSES).toContain('completed')
      expect(TASK_STATUSES).toContain('failed')
      expect(TASK_STATUSES).toContain('deferred')
      expect(TASK_STATUSES).toContain('human-gate')
    })

    it('includes expected event type values', () => {
      expect(EVENT_TYPES).toContain('session.started')
      expect(EVENT_TYPES).toContain('task.dispatched')
      expect(EVENT_TYPES).toContain('task.completed')
    })
  })

  describe('validateTaskEnvelope', () => {
    it('accepts a valid envelope', () => {
      const envelope = createTaskEnvelope({
        capability: 'implementation',
        command: 'implement',
        provider: 'mattpocock-skills',
        context: { cwd: '/repo' },
      })
      expect(validateTaskEnvelope(envelope)).toEqual([])
    })

    it('rejects null', () => {
      expect(validateTaskEnvelope(null)).toContainEqual(expect.stringContaining('non-null object'))
    })

    it('rejects missing capability', () => {
      const issues = validateTaskEnvelope({ command: 'x', provider: 'y', context: {} })
      expect(issues).toContainEqual(expect.stringContaining('capability'))
    })

    it('rejects missing command', () => {
      const issues = validateTaskEnvelope({ capability: 'x', provider: 'y', context: {} })
      expect(issues).toContainEqual(expect.stringContaining('command'))
    })

    it('rejects missing provider', () => {
      const issues = validateTaskEnvelope({ capability: 'x', command: 'y', context: {} })
      expect(issues).toContainEqual(expect.stringContaining('provider'))
    })

    it('rejects missing context', () => {
      const issues = validateTaskEnvelope({ capability: 'x', command: 'y', provider: 'z' })
      expect(issues).toContainEqual(expect.stringContaining('context'))
    })

    it('validates an execution policy when present', () => {
      const issues = validateTaskEnvelope({
        capability: 'x',
        command: 'y',
        provider: 'z',
        context: {},
        execution: { pattern: 'workflow' },
      })
      expect(issues).toContainEqual(expect.stringContaining('partitionable'))
    })
  })

  describe('validateTaskResult', () => {
    it('accepts a valid result', () => {
      expect(validateTaskResult({ status: 'completed' })).toEqual([])
    })

    it('accepts a result with all optional fields', () => {
      const result = createTaskResult('completed', {
        evidence: { tests: 'passed' },
        summary: 'all good',
        artifacts: ['output.json'],
      })
      expect(validateTaskResult(result)).toEqual([])
    })

    it('rejects invalid status', () => {
      expect(validateTaskResult({ status: 'unknown' })).toContainEqual(expect.stringContaining('status'))
    })

    it('rejects non-object evidence', () => {
      expect(validateTaskResult({ status: 'completed', evidence: 'string' }))
        .toContainEqual(expect.stringContaining('evidence'))
    })

    it('rejects non-array artifacts', () => {
      expect(validateTaskResult({ status: 'completed', artifacts: 'file.txt' }))
        .toContainEqual(expect.stringContaining('artifacts'))
    })

    it('rejects artifacts with non-string elements', () => {
      expect(validateTaskResult({ status: 'completed', artifacts: [42] }))
        .toContainEqual(expect.stringContaining('artifacts'))
    })
  })

  describe('validateEvent', () => {
    it('accepts a valid event', () => {
      const event = createEvent('task.dispatched', {
        runtime: 'claude-code',
        payload: { taskId: '123' },
      })
      expect(validateEvent(event)).toEqual([])
    })

    it('rejects unknown event type', () => {
      const event = createEvent('unknown.type', { runtime: 'x', payload: {} })
      expect(validateEvent(event)).toContainEqual(expect.stringContaining('type'))
    })

    it('rejects missing runtime', () => {
      expect(validateEvent({ type: 'task.dispatched', timestamp: new Date().toISOString(), payload: {} }))
        .toContainEqual(expect.stringContaining('runtime'))
    })

    it('rejects missing timestamp', () => {
      expect(validateEvent({ type: 'task.dispatched', runtime: 'x', payload: {} }))
        .toContainEqual(expect.stringContaining('timestamp'))
    })

    it('rejects missing payload', () => {
      expect(validateEvent({ type: 'task.dispatched', runtime: 'x', timestamp: '2024-01-01T00:00:00Z' }))
        .toContainEqual(expect.stringContaining('payload'))
    })
  })

  describe('validateRuntimeStatus', () => {
    it('accepts a valid status', () => {
      expect(validateRuntimeStatus({ available: true, sessions: 1, uptime: 3600 })).toEqual([])
    })

    it('rejects non-boolean available', () => {
      expect(validateRuntimeStatus({ available: 'yes', sessions: 0, uptime: 0 }))
        .toContainEqual(expect.stringContaining('available'))
    })

    it('rejects negative sessions', () => {
      expect(validateRuntimeStatus({ available: true, sessions: -1, uptime: 0 }))
        .toContainEqual(expect.stringContaining('sessions'))
    })

    it('rejects non-integer sessions', () => {
      expect(validateRuntimeStatus({ available: true, sessions: 1.5, uptime: 0 }))
        .toContainEqual(expect.stringContaining('sessions'))
    })

    it('rejects negative uptime', () => {
      expect(validateRuntimeStatus({ available: true, sessions: 0, uptime: -1 }))
        .toContainEqual(expect.stringContaining('uptime'))
    })
  })

  describe('factories', () => {
    it('createTaskEnvelope produces valid envelopes', () => {
      const envelope = createTaskEnvelope({
        capability: 'diagnosis',
        command: 'diagnosing-bugs',
        provider: 'mattpocock-skills',
        context: { state: 'implement' },
      })
      expect(validateTaskEnvelope(envelope)).toEqual([])
      expect(envelope.capability).toBe('diagnosis')
    })

    it('createTaskResult produces valid results', () => {
      const result = createTaskResult('deferred', { summary: 'not implemented yet' })
      expect(validateTaskResult(result)).toEqual([])
      expect(result.status).toBe('deferred')
      expect(result.summary).toBe('not implemented yet')
    })

    it('createEvent produces valid events with auto-timestamp', () => {
      const event = createEvent('session.started', {
        runtime: 'claude-code',
        sessionId: 'sess-1',
        payload: { pid: 1234 },
      })
      expect(validateEvent(event)).toEqual([])
      expect(event.timestamp).toBeDefined()
      expect(event.payload.pid).toBe(1234)
    })

    it('createEvent uses provided timestamp', () => {
      const ts = '2024-06-15T10:00:00Z'
      const event = createEvent('session.ended', { runtime: 'x', timestamp: ts, payload: {} })
      expect(event.timestamp).toBe(ts)
    })
  })
})
