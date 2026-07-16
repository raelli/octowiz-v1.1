'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { createSteering } = require('../../src/multiplayer/steering')

function makeTempFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'octowiz-steer-'))
  return { dir, path: path.join(dir, 'steering.json') }
}

describe('shared steering', () => {
  let tmp, steering

  beforeEach(() => {
    tmp = makeTempFile()
    steering = createSteering({ storePath: tmp.path })
  })

  afterEach(() => { fs.rmSync(tmp.dir, { recursive: true, force: true }) })

  describe('pause / resume', () => {
    it('pauses dispatch', () => {
      steering.pause({ reason: 'reviewing changes' })
      expect(steering.isPaused()).toBe(true)
    })

    it('resumes dispatch', () => {
      steering.pause()
      steering.resume()
      expect(steering.isPaused()).toBe(false)
    })

    it('records who paused and why', () => {
      steering.pause({ by: 'session-human', reason: 'need review' })
      const state = steering.getState()
      expect(state.pausedBy).toBe('session-human')
      expect(state.pauseReason).toBe('need review')
      expect(state.pausedAt).toBeDefined()
    })

    it('clears pause info on resume', () => {
      steering.pause({ by: 'human', reason: 'stop' })
      steering.resume()
      const state = steering.getState()
      expect(state.pausedBy).toBeNull()
      expect(state.pauseReason).toBeNull()
    })
  })

  describe('redirect', () => {
    it('sets a redirection for a session', () => {
      steering.redirect('s1', 'diagnosis')
      const redir = steering.getRedirection('s1')
      expect(redir).toEqual({ capability: 'diagnosis' })
    })

    it('returns null when no redirection pending', () => {
      expect(steering.getRedirection('s1')).toBeNull()
    })

    it('replaces previous redirection for same session', () => {
      steering.redirect('s1', 'diagnosis')
      steering.redirect('s1', 'verification')
      expect(steering.getRedirection('s1').capability).toBe('verification')
    })

    it('clearRedirection removes it', () => {
      steering.redirect('s1', 'diagnosis')
      steering.clearRedirection('s1')
      expect(steering.getRedirection('s1')).toBeNull()
    })
  })

  describe('human gates', () => {
    it('records a human gate', () => {
      steering.recordHumanGate('s1', 'handoff-or-ship', 'merge requires approval')
      const gates = steering.pendingHumanGates()
      expect(gates).toHaveLength(1)
      expect(gates[0].sessionId).toBe('s1')
      expect(gates[0].capability).toBe('handoff-or-ship')
      expect(gates[0].reason).toBe('merge requires approval')
    })

    it('clears a human gate', () => {
      steering.recordHumanGate('s1', 'handoff-or-ship', 'reason')
      steering.clearHumanGate('s1')
      expect(steering.pendingHumanGates()).toHaveLength(0)
    })

    it('supports multiple gates from different sessions', () => {
      steering.recordHumanGate('s1', 'handoff-or-ship', 'r1')
      steering.recordHumanGate('s2', 'code-review', 'r2')
      expect(steering.pendingHumanGates()).toHaveLength(2)
    })
  })

  describe('canDispatch', () => {
    it('allows dispatch when not paused and no gates', () => {
      const result = steering.canDispatch('s1')
      expect(result.allowed).toBe(true)
    })

    it('blocks dispatch when paused', () => {
      steering.pause({ reason: 'reviewing' })
      const result = steering.canDispatch('s1')
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('paused')
      expect(result.reason).toContain('reviewing')
    })

    it('blocks dispatch when session has a human gate', () => {
      steering.recordHumanGate('s1', 'ship', 'needs approval')
      const result = steering.canDispatch('s1')
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('human gate')
    })

    it('does not block other sessions from human gate', () => {
      steering.recordHumanGate('s1', 'ship', 'reason')
      expect(steering.canDispatch('s2').allowed).toBe(true)
    })
  })

  describe('notifications', () => {
    it('calls onNotify for pause', () => {
      const notifications = []
      const s = createSteering({ storePath: tmp.path, onNotify: n => notifications.push(n) })
      s.pause({ reason: 'test' })
      expect(notifications).toHaveLength(1)
      expect(notifications[0].type).toBe('steering.paused')
    })

    it('calls onNotify for human gate', () => {
      const notifications = []
      const s = createSteering({ storePath: tmp.path, onNotify: n => notifications.push(n) })
      s.recordHumanGate('s1', 'ship', 'reason')
      expect(notifications[0].type).toBe('steering.human-gate')
    })

    it('does not throw if onNotify throws', () => {
      const s = createSteering({
        storePath: tmp.path,
        onNotify: () => { throw new Error('broken') },
      })
      expect(() => s.pause()).not.toThrow()
    })
  })

  describe('persistence', () => {
    it('persists state across instances', () => {
      steering.pause({ reason: 'persistent' })
      const s2 = createSteering({ storePath: tmp.path })
      expect(s2.isPaused()).toBe(true)
    })
  })
})
