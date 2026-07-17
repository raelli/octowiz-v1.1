'use strict'

const {
  createEventBus,
  normalizeHookEvent,
  HOOK_TYPE_MAP,
  sessionStarted,
  sessionEnded,
  taskDispatched,
  taskCompleted,
  stateChanged,
  EVENT_TYPES,
  validateEvent,
} = require('../../src/runtimes/events')

describe('event bus', () => {
  let bus

  beforeEach(() => { bus = createEventBus() })

  it('emits events to type-specific listeners', () => {
    const received = []
    bus.on('task.dispatched', e => received.push(e))

    bus.emit(taskDispatched({
      runtime: 'claude-code',
      sessionId: 's1',
      capability: 'implementation',
      provider: 'mp',
      command: 'tdd',
    }))

    expect(received).toHaveLength(1)
    expect(received[0].type).toBe('task.dispatched')
  })

  it('does not emit to unrelated type listeners', () => {
    const received = []
    bus.on('session.started', e => received.push(e))

    bus.emit(taskDispatched({
      runtime: 'claude-code',
      sessionId: 's1',
      capability: 'x',
      provider: 'y',
      command: 'z',
    }))

    expect(received).toHaveLength(0)
  })

  it('emits to wildcard listeners for all events', () => {
    const received = []
    bus.on('*', e => received.push(e))

    bus.emit(sessionStarted({ runtime: 'claude-code', sessionId: 's1' }))
    bus.emit(taskDispatched({ runtime: 'claude-code', sessionId: 's1', capability: 'x', provider: 'y', command: 'z' }))

    expect(received).toHaveLength(2)
  })

  it('supports multiple listeners per type', () => {
    let count = 0
    bus.on('session.ended', () => { count++ })
    bus.on('session.ended', () => { count++ })

    bus.emit(sessionEnded({ runtime: 'claude-code', sessionId: 's1' }))
    expect(count).toBe(2)
  })

  it('unsubscribe removes the listener', () => {
    const received = []
    const unsub = bus.on('task.completed', e => received.push(e))

    bus.emit(taskCompleted({ runtime: 'x', sessionId: 's', capability: 'c', status: 'completed' }))
    unsub()
    bus.emit(taskCompleted({ runtime: 'x', sessionId: 's', capability: 'c', status: 'failed' }))

    expect(received).toHaveLength(1)
  })

  it('throws on invalid event', () => {
    expect(() => bus.emit({ type: 'invalid.type', runtime: 'x', timestamp: 'now', payload: {} }))
      .toThrow(/invalid event/)
  })

  it('throws when required fields are missing', () => {
    expect(() => bus.emit({})).toThrow(/invalid event/)
  })

  it('reports correct listenerCount', () => {
    expect(bus.listenerCount()).toBe(0)
    bus.on('task.dispatched', () => {})
    bus.on('*', () => {})
    expect(bus.listenerCount()).toBe(2)
  })

  it('clear removes all listeners', () => {
    bus.on('task.dispatched', () => {})
    bus.on('*', () => {})
    bus.clear()
    expect(bus.listenerCount()).toBe(0)
  })
})

describe('normalizeHookEvent', () => {
  it('normalizes SessionStart to session.started', () => {
    const event = normalizeHookEvent('SessionStart', { cwd: '/repo' }, { sessionId: 's1', repositoryId: 'r1' })
    expect(event.type).toBe('session.started')
    expect(event.runtime).toBe('claude-code')
    expect(event.sessionId).toBe('s1')
    expect(event.repositoryId).toBe('r1')
    expect(event.payload.hookType).toBe('SessionStart')
    expect(event.payload.cwd).toBe('/repo')
    expect(validateEvent(event)).toEqual([])
  })

  it('normalizes PostToolUse to tool.used', () => {
    const event = normalizeHookEvent('PostToolUse', { tool: 'Write', file: 'x.js' }, { sessionId: 's2' })
    expect(event.type).toBe('tool.used')
    expect(event.payload.tool).toBe('Write')
    expect(validateEvent(event)).toEqual([])
  })

  it('normalizes UserPromptSubmit to prompt.submitted', () => {
    const event = normalizeHookEvent('UserPromptSubmit', { prompt: 'fix it' }, { sessionId: 's3' })
    expect(event.type).toBe('prompt.submitted')
    expect(event.payload.prompt).toBe('fix it')
  })

  it('normalizes SessionEnd to session.ended', () => {
    const event = normalizeHookEvent('SessionEnd', {}, { sessionId: 's4' })
    expect(event.type).toBe('session.ended')
  })

  it('normalizes Stop to session.ended', () => {
    const event = normalizeHookEvent('Stop', {}, { sessionId: 's5' })
    expect(event.type).toBe('session.ended')
  })

  it('defaults unknown hook types to tool.used', () => {
    const event = normalizeHookEvent('UnknownHook', { data: 123 }, { sessionId: 's6' })
    expect(event.type).toBe('tool.used')
    expect(event.payload.hookType).toBe('UnknownHook')
  })

  it('always produces a valid event', () => {
    for (const hookType of Object.keys(HOOK_TYPE_MAP)) {
      const event = normalizeHookEvent(hookType, {}, { sessionId: 'test' })
      expect(validateEvent(event)).toEqual([])
    }
  })
})

describe('factory helpers', () => {
  it('sessionStarted produces valid event', () => {
    const event = sessionStarted({ runtime: 'opencode', sessionId: 's1', repositoryId: 'r1', metadata: { pid: 42 } })
    expect(validateEvent(event)).toEqual([])
    expect(event.type).toBe('session.started')
    expect(event.payload.metadata.pid).toBe(42)
  })

  it('sessionEnded produces valid event with reason', () => {
    const event = sessionEnded({ runtime: 'claude-code', sessionId: 's1', reason: 'idle timeout' })
    expect(validateEvent(event)).toEqual([])
    expect(event.type).toBe('session.ended')
    expect(event.payload.reason).toBe('idle timeout')
  })

  it('taskDispatched produces valid event', () => {
    const event = taskDispatched({
      runtime: 'claude-code',
      sessionId: 's1',
      repositoryId: 'r1',
      capability: 'implementation',
      provider: 'mattpocock-skills',
      command: 'tdd',
      execution: { pattern: 'advisor' },
    })
    expect(validateEvent(event)).toEqual([])
    expect(event.type).toBe('task.dispatched')
    expect(event.payload.capability).toBe('implementation')
    expect(event.payload.provider).toBe('mattpocock-skills')
    expect(event.payload.execution.pattern).toBe('advisor')
  })

  it('taskCompleted produces valid event', () => {
    const event = taskCompleted({
      runtime: 'claude-code',
      sessionId: 's1',
      capability: 'diagnosis',
      status: 'failed',
      summary: 'root cause found',
    })
    expect(validateEvent(event)).toEqual([])
    expect(event.type).toBe('task.completed')
    expect(event.payload.status).toBe('failed')
  })

  it('stateChanged produces valid event', () => {
    const event = stateChanged({
      runtime: 'claude-code',
      sessionId: 's1',
      repositoryId: 'r1',
      from: 'implement',
      to: 'verify',
      revision: 5,
    })
    expect(validateEvent(event)).toEqual([])
    expect(event.type).toBe('state.changed')
    expect(event.payload.from).toBe('implement')
    expect(event.payload.to).toBe('verify')
    expect(event.payload.revision).toBe(5)
  })
})

describe('constants', () => {
  it('re-exports EVENT_TYPES', () => {
    expect(EVENT_TYPES).toContain('session.started')
    expect(EVENT_TYPES).toContain('task.dispatched')
  })

  it('hook type map covers known Claude Code hooks', () => {
    expect(HOOK_TYPE_MAP.SessionStart).toBe('session.started')
    expect(HOOK_TYPE_MAP.PostToolUse).toBe('tool.used')
    expect(HOOK_TYPE_MAP.UserPromptSubmit).toBe('prompt.submitted')
    expect(HOOK_TYPE_MAP.SessionEnd).toBe('session.ended')
  })
})
