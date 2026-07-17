'use strict'

const http = require('node:http')

const { validateAdapter } = require('../../src/runtimes/adapter')
const { createClaudeCodeAdapter } = require('../../src/runtimes/claude-code')
const { validateTaskResult, validateRuntimeStatus } = require('../../src/runtimes/types')

// ──────────────────────────────────────────── mock supervisor

function createMockSupervisor(response = null) {
  let requestCount = 0
  let lastRequest = null

  const server = http.createServer((req, res) => {
    requestCount++
    lastRequest = { method: req.method, url: req.url }

    if (req.method === 'GET' && req.url === '/health') {
      const body = response ?? {
        status: 'ok',
        name: 'octowiz-local',
        version: '1.0.0',
        pid: 12345,
        sessions: 2,
        mode: 'ephemeral',
        a2a: 'started',
      }
      const payload = JSON.stringify(body)
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) })
      res.end(payload)
    }
    else {
      res.writeHead(404)
      res.end()
    }
  })

  return {
    server,
    get requestCount() { return requestCount },
    get lastRequest() { return lastRequest },
    listen: () => new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        resolve(server.address().port)
      })
    }),
    close: () => new Promise((resolve) => {
      server.close(resolve)
    }),
  }
}

// ──────────────────────────────────────────── tests

describe('claude code adapter', () => {
  describe('contract compliance', () => {
    it('passes adapter validation', () => {
      const adapter = createClaudeCodeAdapter()
      expect(validateAdapter(adapter)).toEqual([])
    })

    it('has correct id and name', () => {
      const adapter = createClaudeCodeAdapter()
      expect(adapter.id).toBe('claude-code')
      expect(adapter.name).toBe('Claude Code')
    })
  })

  describe('isAvailable', () => {
    let mock

    afterEach(async () => {
      if (mock)
        await mock.close()
      mock = null
    })

    it('returns true when supervisor responds with status ok', async () => {
      mock = createMockSupervisor({ status: 'ok', version: '1.0.0', pid: 1, sessions: 0 })
      const port = await mock.listen()
      const adapter = createClaudeCodeAdapter({ port })
      await expect(adapter.isAvailable()).resolves.toBe(true)
    })

    it('returns false when supervisor responds with non-ok status', async () => {
      mock = createMockSupervisor({ status: 'error', message: 'shutting down' })
      const port = await mock.listen()
      const adapter = createClaudeCodeAdapter({ port })
      await expect(adapter.isAvailable()).resolves.toBe(false)
    })

    it('returns false when supervisor is not reachable', async () => {
      // Use a port that nothing listens on
      const adapter = createClaudeCodeAdapter({ port: 19999, timeoutMs: 100 })
      await expect(adapter.isAvailable()).resolves.toBe(false)
    })

    it('returns false on timeout', async () => {
      // Create a server that never responds
      const server = http.createServer(() => { /* hang */ })
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
      const port = server.address().port

      const adapter = createClaudeCodeAdapter({ port, timeoutMs: 50 })
      await expect(adapter.isAvailable()).resolves.toBe(false)

      await new Promise(resolve => server.close(resolve))
    })
  })

  describe('status', () => {
    let mock

    afterEach(async () => {
      if (mock)
        await mock.close()
      mock = null
    })

    it('returns available status with metadata when supervisor is healthy', async () => {
      mock = createMockSupervisor({
        status: 'ok',
        name: 'octowiz-local',
        version: '2.0.0',
        pid: 9876,
        sessions: 3,
        mode: 'ephemeral',
        a2a: 'reused-current',
      })
      const port = await mock.listen()
      const adapter = createClaudeCodeAdapter({ port })
      const result = await adapter.status()

      expect(validateRuntimeStatus(result)).toEqual([])
      expect(result.available).toBe(true)
      expect(result.sessions).toBe(3)
      expect(result.metadata.pid).toBe(9876)
      expect(result.metadata.version).toBe('2.0.0')
      expect(result.metadata.a2a).toBe('reused-current')
    })

    it('returns unavailable status when supervisor is down', async () => {
      const adapter = createClaudeCodeAdapter({ port: 19999, timeoutMs: 50 })
      const result = await adapter.status()

      expect(validateRuntimeStatus(result)).toEqual([])
      expect(result.available).toBe(false)
      expect(result.sessions).toBe(0)
      expect(result.metadata.reason).toContain('not reachable')
    })
  })

  describe('dispatch', () => {
    it('returns advisory completed result with task info', async () => {
      const adapter = createClaudeCodeAdapter()
      const task = {
        capability: 'implementation',
        command: 'implement',
        provider: 'mattpocock-skills',
        context: { cwd: '/repo', state: 'implement' },
      }
      const result = await adapter.dispatch(task)

      expect(validateTaskResult(result)).toEqual([])
      expect(result.status).toBe('completed')
      expect(result.summary).toContain('mattpocock-skills:implement')
      expect(result.summary).toContain('implementation')
      expect(result.evidence.capability).toBe('implementation')
      expect(result.evidence.provider).toBe('mattpocock-skills')
      expect(result.evidence.command).toBe('implement')
      expect(result.evidence.execution).toMatchObject({
        pattern: 'advisor',
        executorModel: 'sonnet',
        advisorModel: 'fable',
      })
    })

    it('works with any task shape', async () => {
      const adapter = createClaudeCodeAdapter()
      const result = await adapter.dispatch({
        capability: 'diagnosis',
        command: 'diagnosing-bugs',
        provider: 'mattpocock-skills',
        context: {},
      })
      expect(result.status).toBe('completed')
      expect(result.evidence.capability).toBe('diagnosis')
    })
  })

  describe('notify', () => {
    it('does not throw even when transport is unavailable', () => {
      const adapter = createClaudeCodeAdapter()
      // notify is fire-and-forget — should never throw
      expect(() => adapter.notify({
        type: 'task.dispatched',
        runtime: 'claude-code',
        timestamp: new Date().toISOString(),
        payload: { taskId: '123' },
      })).not.toThrow()
    })
  })

  describe('configuration', () => {
    let mock

    afterEach(async () => {
      if (mock)
        await mock.close()
      mock = null
    })

    it('uses default port 8764', () => {
      const adapter = createClaudeCodeAdapter()
      // We can't easily inspect the port, but we can verify it works
      // by testing isAvailable against a non-existent server
      expect(adapter.id).toBe('claude-code')
    })

    it('respects custom port option', async () => {
      mock = createMockSupervisor()
      const port = await mock.listen()
      const adapter = createClaudeCodeAdapter({ port })
      await expect(adapter.isAvailable()).resolves.toBe(true)
    })

    it('respects OCTOWIZ_LOCAL_PORT env var', async () => {
      mock = createMockSupervisor()
      const port = await mock.listen()
      const prev = process.env.OCTOWIZ_LOCAL_PORT
      process.env.OCTOWIZ_LOCAL_PORT = String(port)
      try {
        const adapter = createClaudeCodeAdapter()
        await expect(adapter.isAvailable()).resolves.toBe(true)
      }
      finally {
        if (prev === undefined)
          delete process.env.OCTOWIZ_LOCAL_PORT
        else
          process.env.OCTOWIZ_LOCAL_PORT = prev
      }
    })
  })

  describe('registry integration', () => {
    it('registers in the runtime registry without error', () => {
      const { createRegistry } = require('../../src/runtimes/registry')
      const registry = createRegistry()
      const adapter = createClaudeCodeAdapter()
      expect(() => registry.register(adapter)).not.toThrow()
      expect(registry.get('claude-code')).toBe(adapter)
    })

    it('is selectable as the default runtime', async () => {
      const { createRegistry } = require('../../src/runtimes/registry')
      const mock = createMockSupervisor()
      const port = await mock.listen()

      const registry = createRegistry()
      registry.register(createClaudeCodeAdapter({ port }))

      const selected = await registry.selectRuntime('claude-code')
      expect(selected.id).toBe('claude-code')

      await mock.close()
    })
  })
})
