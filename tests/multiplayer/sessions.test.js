'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { createOwnershipManager } = require('../../src/multiplayer/ownership')
const { createSessionLedger } = require('../../src/multiplayer/sessions')

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'octowiz-mp-'))
}

describe('session ledger', () => {
  let dir, ledger

  beforeEach(() => {
    dir = makeTempDir()
    ledger = createSessionLedger({
      repositoryId: 'test-repo',
      storePath: path.join(dir, 'sessions.json'),
      heartbeatTtlMs: 100,
    })
  })

  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

  describe('register', () => {
    it('registers a new session', () => {
      const entry = ledger.register({ sessionId: 's1' })
      expect(entry.sessionId).toBe('s1')
      expect(entry.status).toBe('active')
      expect(entry.runtime).toBe('claude-code')
      expect(entry.actor).toBe('human-assisted')
    })

    it('refreshes an existing session', () => {
      ledger.register({ sessionId: 's1', actor: 'human-assisted' })
      const updated = ledger.register({ sessionId: 's1', actor: 'autonomous' })
      expect(updated.actor).toBe('autonomous')
      expect(ledger.allSessions()).toHaveLength(1)
    })

    it('supports multiple sessions', () => {
      ledger.register({ sessionId: 's1' })
      ledger.register({ sessionId: 's2', runtime: 'opencode' })
      expect(ledger.allSessions()).toHaveLength(2)
    })
  })

  describe('heartbeat', () => {
    it('updates lastHeartbeat for existing session', () => {
      ledger.register({ sessionId: 's1' })
      expect(ledger.heartbeat('s1')).toBe(true)
    })

    it('returns false for unknown session', () => {
      expect(ledger.heartbeat('unknown')).toBe(false)
    })
  })

  describe('release', () => {
    it('removes a session', () => {
      ledger.register({ sessionId: 's1' })
      expect(ledger.release('s1')).toBe(true)
      expect(ledger.allSessions()).toHaveLength(0)
    })

    it('returns false for unknown session', () => {
      expect(ledger.release('unknown')).toBe(false)
    })
  })

  describe('stale detection', () => {
    it('marks sessions stale after heartbeat TTL', async () => {
      ledger.register({ sessionId: 's1' })
      await new Promise(resolve => setTimeout(resolve, 150))
      const sessions = ledger.activeSessions()
      expect(sessions).toHaveLength(0)
      expect(ledger.allSessions()[0].status).toBe('stale')
    })

    it('keeps sessions active within TTL', () => {
      ledger.register({ sessionId: 's1' })
      const sessions = ledger.activeSessions()
      expect(sessions).toHaveLength(1)
      expect(sessions[0].status).toBe('active')
    })

    it('purgeStale removes stale sessions', async () => {
      ledger.register({ sessionId: 's1' })
      ledger.register({ sessionId: 's2' })
      await new Promise(resolve => setTimeout(resolve, 150))
      const purged = ledger.purgeStale()
      expect(purged).toBe(2)
      expect(ledger.allSessions()).toHaveLength(0)
    })
  })

  describe('getSession', () => {
    it('finds a session by id', () => {
      ledger.register({ sessionId: 's1', runtime: 'opencode' })
      const session = ledger.getSession('s1')
      expect(session.runtime).toBe('opencode')
    })

    it('returns null for unknown', () => {
      expect(ledger.getSession('nope')).toBeNull()
    })
  })
})

describe('ownership manager', () => {
  let dir, ledger, ownership

  beforeEach(() => {
    dir = makeTempDir()
    ledger = createSessionLedger({
      repositoryId: 'test-repo',
      storePath: path.join(dir, 'sessions.json'),
      heartbeatTtlMs: 60000,
    })
    ownership = createOwnershipManager({ ledger, strict: false })
  })

  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

  describe('claimFiles', () => {
    it('claims unowned files', () => {
      ledger.register({ sessionId: 's1' })
      const result = ownership.claimFiles('s1', ['src/a.js', 'src/b.js'])
      expect(result.claimed).toEqual(['src/a.js', 'src/b.js'])
      expect(result.conflicts).toEqual([])
    })

    it('detects conflicts with other sessions', () => {
      ledger.register({ sessionId: 's1' })
      ownership.claimFiles('s1', ['src/a.js'])

      ledger.register({ sessionId: 's2' })
      const result = ownership.claimFiles('s2', ['src/a.js', 'src/b.js'])
      expect(result.claimed).toEqual(['src/b.js'])
      expect(result.conflicts).toHaveLength(1)
      expect(result.conflicts[0]).toEqual({ file: 'src/a.js', owner: 's1', claimant: 's2' })
    })

    it('allows same session to re-claim its own files', () => {
      ledger.register({ sessionId: 's1' })
      ownership.claimFiles('s1', ['src/a.js'])
      const result = ownership.claimFiles('s1', ['src/a.js'])
      expect(result.claimed).toEqual(['src/a.js'])
      expect(result.conflicts).toEqual([])
    })
  })

  describe('strict mode', () => {
    it('throws on conflict when strict', () => {
      const strictOwnership = createOwnershipManager({ ledger, strict: true })
      ledger.register({ sessionId: 's1' })
      strictOwnership.claimFiles('s1', ['src/a.js'])
      ledger.register({ sessionId: 's2' })
      expect(() => strictOwnership.claimFiles('s2', ['src/a.js'])).toThrow(/ownership conflict/)
    })
  })

  describe('releaseFiles', () => {
    it('releases specific files', () => {
      ledger.register({ sessionId: 's1' })
      ownership.claimFiles('s1', ['src/a.js', 'src/b.js'])
      ownership.releaseFiles('s1', ['src/a.js'])
      expect(ownership.getFileOwner('src/a.js')).toBeNull()
      expect(ownership.getFileOwner('src/b.js')).not.toBeNull()
    })
  })

  describe('releaseAll', () => {
    it('releases all files for a session', () => {
      ledger.register({ sessionId: 's1' })
      ownership.claimFiles('s1', ['src/a.js', 'src/b.js'])
      ownership.releaseAll('s1')
      expect(ownership.getFileOwner('src/a.js')).toBeNull()
      expect(ownership.getFileOwner('src/b.js')).toBeNull()
    })
  })

  describe('getFileOwner', () => {
    it('returns owner info', () => {
      ledger.register({ sessionId: 's1', runtime: 'opencode' })
      ownership.claimFiles('s1', ['x.js'])
      const owner = ownership.getFileOwner('x.js')
      expect(owner).toEqual({ sessionId: 's1', runtime: 'opencode' })
    })

    it('returns null for unowned file', () => {
      expect(ownership.getFileOwner('unowned.js')).toBeNull()
    })
  })

  describe('allOwnedFiles', () => {
    it('returns all ownership mappings', () => {
      ledger.register({ sessionId: 's1' })
      ledger.register({ sessionId: 's2' })
      ownership.claimFiles('s1', ['a.js'])
      ownership.claimFiles('s2', ['b.js'])
      const map = ownership.allOwnedFiles()
      expect(map.get('a.js')).toBe('s1')
      expect(map.get('b.js')).toBe('s2')
    })
  })

  describe('checkConflicts', () => {
    it('reports conflicts without claiming', () => {
      ledger.register({ sessionId: 's1' })
      ownership.claimFiles('s1', ['a.js'])
      ledger.register({ sessionId: 's2' })
      const conflicts = ownership.checkConflicts('s2', ['a.js', 'b.js'])
      expect(conflicts).toHaveLength(1)
      expect(conflicts[0].file).toBe('a.js')
      // Verify nothing was claimed
      expect(ownership.getFileOwner('b.js')).toBeNull()
    })
  })
})
