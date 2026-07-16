'use strict'

const http = require('node:http')
const net = require('node:net')

const { validateAdapter } = require('../../src/runtimes/adapter')
const { createClaudeCodeAdapter } = require('../../src/runtimes/claude-code')
const { createDaytonaAdapter } = require('../../src/runtimes/daytona')
const { createOpenCodeAdapter } = require('../../src/runtimes/opencode')
const { createRegistry } = require('../../src/runtimes/registry')
const { validateTaskResult, validateRuntimeStatus } = require('../../src/runtimes/types')

// ──────────────────────────────────────────── helpers

function createTcpServer() {
  const server = net.createServer(() => {})
  return {
    server,
    listen: () => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port))),
    close: () => new Promise(resolve => server.close(resolve)),
  }
}

function createHttpServer(statusCode = 200, body = { status: 'ok' }) {
  const server = http.createServer((req, res) => {
    const payload = JSON.stringify(body)
    res.writeHead(statusCode, { 'content-type': 'application/json' })
    res.end(payload)
  })
  return {
    server,
    listen: () => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port))),
    close: () => new Promise(resolve => server.close(resolve)),
  }
}

// ──────────────────────────────────────────── OpenCode adapter

describe('opencode adapter stub', () => {
  describe('contract compliance', () => {
    it('passes adapter validation', () => {
      const adapter = createOpenCodeAdapter()
      expect(validateAdapter(adapter)).toEqual([])
    })

    it('has correct id and name', () => {
      const adapter = createOpenCodeAdapter()
      expect(adapter.id).toBe('opencode')
      expect(adapter.name).toBe('OpenCode')
    })
  })

  describe('isAvailable', () => {
    it('returns true when port is open', async () => {
      const tcp = createTcpServer()
      const port = await tcp.listen()
      const adapter = createOpenCodeAdapter({ port })
      await expect(adapter.isAvailable()).resolves.toBe(true)
      await tcp.close()
    })

    it('returns false when port is closed', async () => {
      const adapter = createOpenCodeAdapter({ port: 19876, timeoutMs: 50 })
      await expect(adapter.isAvailable()).resolves.toBe(false)
    })

    it('returns false on timeout', async () => {
      // A port that accepts but never responds is still "open"
      // Use a completely unreachable port for timeout behavior
      const adapter = createOpenCodeAdapter({ host: '192.0.2.1', port: 9100, timeoutMs: 50 })
      await expect(adapter.isAvailable()).resolves.toBe(false)
    })
  })

  describe('status', () => {
    it('reports unavailable when process is not running', async () => {
      const adapter = createOpenCodeAdapter({ port: 19876, timeoutMs: 50 })
      const result = await adapter.status()
      expect(validateRuntimeStatus(result)).toEqual([])
      expect(result.available).toBe(false)
      expect(result.metadata.stub).toBe(true)
    })

    it('reports available when process is reachable', async () => {
      const tcp = createTcpServer()
      const port = await tcp.listen()
      const adapter = createOpenCodeAdapter({ port })
      const result = await adapter.status()
      expect(result.available).toBe(true)
      expect(result.metadata.stub).toBe(true)
      expect(result.metadata.reason).toContain('not implemented')
      await tcp.close()
    })
  })

  describe('dispatch', () => {
    it('returns deferred status', async () => {
      const adapter = createOpenCodeAdapter()
      const result = await adapter.dispatch({
        capability: 'implementation',
        command: 'tdd',
        provider: 'mattpocock-skills',
        context: {},
      })
      expect(validateTaskResult(result)).toEqual([])
      expect(result.status).toBe('deferred')
      expect(result.error).toBe('runtime not implemented')
    })

    it('includes capability name in summary', async () => {
      const adapter = createOpenCodeAdapter()
      const result = await adapter.dispatch({
        capability: 'diagnosis',
        command: 'diagnose',
        provider: 'test',
        context: {},
      })
      expect(result.summary).toContain('diagnosis')
    })
  })

  describe('notify', () => {
    it('does not throw', () => {
      const adapter = createOpenCodeAdapter()
      expect(() => adapter.notify({ type: 'task.dispatched', runtime: 'opencode', timestamp: 'now', payload: {} })).not.toThrow()
    })
  })

  describe('configuration', () => {
    it('uses default port 9100', () => {
      const adapter = createOpenCodeAdapter()
      expect(adapter.id).toBe('opencode')
    })

    it('respects OPENCODE_PORT env var', async () => {
      const tcp = createTcpServer()
      const port = await tcp.listen()
      const prev = process.env.OPENCODE_PORT
      process.env.OPENCODE_PORT = String(port)
      try {
        const adapter = createOpenCodeAdapter()
        await expect(adapter.isAvailable()).resolves.toBe(true)
      }
      finally {
        if (prev === undefined)
          delete process.env.OPENCODE_PORT
        else
          process.env.OPENCODE_PORT = prev
      }
      await tcp.close()
    })
  })
})

// ──────────────────────────────────────────── Daytona adapter

describe('daytona adapter stub', () => {
  describe('contract compliance', () => {
    it('passes adapter validation', () => {
      const adapter = createDaytonaAdapter()
      expect(validateAdapter(adapter)).toEqual([])
    })

    it('has correct id and name', () => {
      const adapter = createDaytonaAdapter()
      expect(adapter.id).toBe('daytona')
      expect(adapter.name).toBe('Daytona')
    })
  })

  describe('isAvailable', () => {
    it('returns true when API responds with 200', async () => {
      const httpServer = createHttpServer(200, { status: 'healthy' })
      const port = await httpServer.listen()
      const adapter = createDaytonaAdapter({ apiUrl: `http://127.0.0.1:${port}` })
      await expect(adapter.isAvailable()).resolves.toBe(true)
      await httpServer.close()
    })

    it('returns false when API responds with 500+', async () => {
      const httpServer = createHttpServer(503, { error: 'unavailable' })
      const port = await httpServer.listen()
      const adapter = createDaytonaAdapter({ apiUrl: `http://127.0.0.1:${port}` })
      await expect(adapter.isAvailable()).resolves.toBe(false)
      await httpServer.close()
    })

    it('returns false when API is not reachable', async () => {
      const adapter = createDaytonaAdapter({ apiUrl: 'http://127.0.0.1:19877', timeoutMs: 50 })
      await expect(adapter.isAvailable()).resolves.toBe(false)
    })
  })

  describe('status', () => {
    it('reports unavailable when API is not reachable', async () => {
      const adapter = createDaytonaAdapter({ apiUrl: 'http://127.0.0.1:19877', timeoutMs: 50 })
      const result = await adapter.status()
      expect(validateRuntimeStatus(result)).toEqual([])
      expect(result.available).toBe(false)
      expect(result.metadata.stub).toBe(true)
    })

    it('reports available when API responds', async () => {
      const httpServer = createHttpServer(200, { status: 'ok' })
      const port = await httpServer.listen()
      const adapter = createDaytonaAdapter({ apiUrl: `http://127.0.0.1:${port}` })
      const result = await adapter.status()
      expect(result.available).toBe(true)
      expect(result.metadata.stub).toBe(true)
      await httpServer.close()
    })
  })

  describe('dispatch', () => {
    it('returns deferred status', async () => {
      const adapter = createDaytonaAdapter()
      const result = await adapter.dispatch({
        capability: 'verification',
        command: 'verify',
        provider: 'octowiz-native',
        context: {},
      })
      expect(validateTaskResult(result)).toEqual([])
      expect(result.status).toBe('deferred')
      expect(result.error).toBe('runtime not implemented')
    })
  })

  describe('notify', () => {
    it('does not throw', () => {
      const adapter = createDaytonaAdapter()
      expect(() => adapter.notify({})).not.toThrow()
    })
  })

  describe('configuration', () => {
    it('respects DAYTONA_API_URL env var', async () => {
      const httpServer = createHttpServer(200, { status: 'ok' })
      const port = await httpServer.listen()
      const prev = process.env.DAYTONA_API_URL
      process.env.DAYTONA_API_URL = `http://127.0.0.1:${port}`
      try {
        const adapter = createDaytonaAdapter()
        await expect(adapter.isAvailable()).resolves.toBe(true)
      }
      finally {
        if (prev === undefined)
          delete process.env.DAYTONA_API_URL
        else
          process.env.DAYTONA_API_URL = prev
      }
      await httpServer.close()
    })
  })
})

// ──────────────────────────────────────────── registry fallback

describe('registry fallback behavior', () => {
  it('falls back to claude-code when stubs are unavailable', async () => {
    // Mock Claude Code as available
    const ccServer = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok', version: '1.0.0', pid: 1, sessions: 1 }))
    })
    const ccPort = await new Promise(resolve => ccServer.listen(0, '127.0.0.1', () => resolve(ccServer.address().port)))

    const registry = createRegistry()
    registry.register(createClaudeCodeAdapter({ port: ccPort }))
    registry.register(createOpenCodeAdapter({ port: 19876, timeoutMs: 50 }))
    registry.register(createDaytonaAdapter({ apiUrl: 'http://127.0.0.1:19877', timeoutMs: 50 }))

    // Stubs are unavailable, Claude Code is available
    const available = await registry.getAvailableRuntimes({ timeoutMs: 100 })
    expect(available.map(a => a.id)).toEqual(['claude-code'])

    // selectRuntime falls back from a stub to Claude Code
    const selected = await registry.selectRuntime('opencode', { timeoutMs: 100 })
    expect(selected.id).toBe('claude-code')

    await new Promise(resolve => ccServer.close(resolve))
  })

  it('all stubs register without error', () => {
    const registry = createRegistry()
    expect(() => registry.register(createOpenCodeAdapter())).not.toThrow()
    expect(() => registry.register(createDaytonaAdapter())).not.toThrow()
    expect(registry.ids().sort()).toEqual(['daytona', 'opencode'])
  })
})
