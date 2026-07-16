'use strict'

const { createTaskLeaseManager } = require('../../src/multiplayer/task-leases')

describe('task leases', () => {
  let manager

  beforeEach(() => {
    manager = createTaskLeaseManager({ leaseDurationMs: 100 })
  })

  describe('claim', () => {
    it('grants a lease for an unclaimed task', () => {
      const result = manager.claim('task-1', 'session-a')
      expect(result.ok).toBe(true)
      expect(result.token).toBeDefined()
      expect(result.expiresAt).toBeDefined()
    })

    it('rejects claim by different session on active lease', () => {
      manager.claim('task-1', 'session-a')
      const result = manager.claim('task-1', 'session-b')
      expect(result.ok).toBe(false)
      expect(result.reason).toBe('already claimed')
      expect(result.owner).toBe('session-a')
    })

    it('allows same session to re-claim (idempotent)', () => {
      const first = manager.claim('task-1', 'session-a')
      const second = manager.claim('task-1', 'session-a')
      expect(second.ok).toBe(true)
      expect(second.token).toBe(first.token)
    })

    it('allows claim after lease expires', async () => {
      manager.claim('task-1', 'session-a')
      await new Promise(resolve => setTimeout(resolve, 150))
      const result = manager.claim('task-1', 'session-b')
      expect(result.ok).toBe(true)
    })

    it('supports custom duration', () => {
      const result = manager.claim('task-1', 'session-a', { durationMs: 60000 })
      expect(result.ok).toBe(true)
      const expires = new Date(result.expiresAt).getTime()
      expect(expires).toBeGreaterThan(Date.now() + 50000)
    })
  })

  describe('renew', () => {
    it('extends lease expiry', () => {
      const { token, expiresAt: before } = manager.claim('task-1', 'session-a')
      const result = manager.renew(token)
      expect(result.ok).toBe(true)
      expect(new Date(result.expiresAt).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime())
    })

    it('fails for unknown token', () => {
      const result = manager.renew('invalid-token')
      expect(result.ok).toBe(false)
      expect(result.reason).toBe('unknown lease token')
    })

    it('fails for expired lease', async () => {
      const { token } = manager.claim('task-1', 'session-a')
      await new Promise(resolve => setTimeout(resolve, 150))
      const result = manager.renew(token)
      expect(result.ok).toBe(false)
      expect(result.reason).toContain('expired')
    })
  })

  describe('release', () => {
    it('releases an active lease', () => {
      const { token } = manager.claim('task-1', 'session-a')
      expect(manager.release(token)).toBe(true)
      expect(manager.getLease('task-1')).toBeNull()
    })

    it('returns false for unknown token', () => {
      expect(manager.release('nonexistent')).toBe(false)
    })

    it('allows reclaim after release', () => {
      const { token } = manager.claim('task-1', 'session-a')
      manager.release(token)
      const result = manager.claim('task-1', 'session-b')
      expect(result.ok).toBe(true)
    })
  })

  describe('getLease', () => {
    it('returns active lease', () => {
      manager.claim('task-1', 'session-a')
      const lease = manager.getLease('task-1')
      expect(lease).not.toBeNull()
      expect(lease.taskId).toBe('task-1')
      expect(lease.sessionId).toBe('session-a')
    })

    it('returns null for unclaimed task', () => {
      expect(manager.getLease('nonexistent')).toBeNull()
    })

    it('returns null for expired lease', async () => {
      manager.claim('task-1', 'session-a')
      await new Promise(resolve => setTimeout(resolve, 150))
      expect(manager.getLease('task-1')).toBeNull()
    })
  })

  describe('activeLeases', () => {
    it('returns all active leases', () => {
      manager.claim('task-1', 'session-a')
      manager.claim('task-2', 'session-b')
      expect(manager.activeLeases()).toHaveLength(2)
    })

    it('excludes expired leases', async () => {
      manager.claim('task-1', 'session-a')
      await new Promise(resolve => setTimeout(resolve, 150))
      expect(manager.activeLeases()).toHaveLength(0)
    })
  })

  describe('expireStale', () => {
    it('removes expired leases', async () => {
      manager.claim('task-1', 'session-a')
      manager.claim('task-2', 'session-b')
      await new Promise(resolve => setTimeout(resolve, 150))
      const expired = manager.expireStale()
      expect(expired).toBe(2)
    })

    it('does not remove active leases', () => {
      manager.claim('task-1', 'session-a')
      expect(manager.expireStale()).toBe(0)
    })
  })
})
