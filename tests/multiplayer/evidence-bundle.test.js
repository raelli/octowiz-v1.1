'use strict'

const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { createBundle, verifyBundle, signBundle, sha256, BUNDLE_VERSION } = require('../../src/multiplayer/evidence-bundle')

function makeGitRepo() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'octowiz-eb-')))
  execFileSync('git', ['-C', dir, 'init', '-q'])
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'test@test.com'])
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'Test'])
  fs.writeFileSync(path.join(dir, 'file.txt'), 'content\n')
  execFileSync('git', ['-C', dir, 'add', '.'])
  execFileSync('git', ['-C', dir, 'commit', '-m', 'init', '-q'])
  return dir
}

describe('evidence bundles', () => {
  let repo

  beforeEach(() => { repo = makeGitRepo() })
  afterEach(() => { fs.rmSync(repo, { recursive: true, force: true }) })

  describe('createBundle', () => {
    it('produces a valid bundle from current state', () => {
      const bundle = createBundle({
        repositoryId: 'test-repo',
        cwd: repo,
        sessionId: 'sess-1',
        evidence: [{ kind: 'tests', status: 'passed', ref: 'jest 42 suites' }],
        criteria: [{ id: 'ac-1', status: 'passed' }],
      })
      expect(bundle.bundleVersion).toBe(BUNDLE_VERSION)
      expect(bundle.repositoryId).toBe('test-repo')
      expect(bundle.commit).toHaveLength(12)
      expect(bundle.commitSha256).toHaveLength(64)
      expect(bundle.session).toBe('sess-1')
      expect(bundle.runtime).toBe('claude-code')
      expect(bundle.evidence).toHaveLength(1)
      expect(bundle.criteria).toHaveLength(1)
      expect(bundle.signature).toBeNull()
    })

    it('includes timestamp', () => {
      const bundle = createBundle({ repositoryId: 'r', cwd: repo, sessionId: 's' })
      expect(bundle.timestamp).toBeDefined()
      expect(new Date(bundle.timestamp).getTime()).not.toBeNaN()
    })

    it('signs bundle when signingKey is provided', () => {
      const bundle = createBundle({
        repositoryId: 'r',
        cwd: repo,
        sessionId: 's',
        signingKey: 'test-secret-key',
        keyId: 'test-key',
      })
      expect(bundle.signature).not.toBeNull()
      expect(bundle.signature.algorithm).toBe('hmac-sha256')
      expect(bundle.signature.keyId).toBe('test-key')
      expect(bundle.signature.value).toHaveLength(64)
    })
  })

  describe('verifyBundle', () => {
    it('verifies an unsigned bundle against HEAD', () => {
      const bundle = createBundle({ repositoryId: 'r', cwd: repo, sessionId: 's' })
      const result = verifyBundle(bundle, { cwd: repo })
      expect(result.valid).toBe(true)
      expect(result.issues).toEqual([])
    })

    it('detects commit mismatch when HEAD changes', () => {
      const bundle = createBundle({ repositoryId: 'r', cwd: repo, sessionId: 's' })
      // Make a new commit
      fs.writeFileSync(path.join(repo, 'new.txt'), 'new\n')
      execFileSync('git', ['-C', repo, 'add', '.'])
      execFileSync('git', ['-C', repo, 'commit', '-m', 'change', '-q'])
      const result = verifyBundle(bundle, { cwd: repo })
      expect(result.valid).toBe(false)
      expect(result.issues[0]).toContain('commit hash mismatch')
    })

    it('verifies a signed bundle', () => {
      const key = 'secret-key-123'
      const bundle = createBundle({ repositoryId: 'r', cwd: repo, sessionId: 's', signingKey: key })
      const result = verifyBundle(bundle, { cwd: repo, signingKey: key })
      expect(result.valid).toBe(true)
    })

    it('detects tampered signed bundle', () => {
      const key = 'secret-key-123'
      const bundle = createBundle({ repositoryId: 'r', cwd: repo, sessionId: 's', signingKey: key })
      bundle.evidence = [{ kind: 'tests', status: 'passed', ref: 'tampered' }]
      const result = verifyBundle(bundle, { cwd: repo, signingKey: key })
      expect(result.valid).toBe(false)
      expect(result.issues[0]).toContain('tampered')
    })

    it('warns when bundle is signed but no key provided', () => {
      const bundle = createBundle({ repositoryId: 'r', cwd: repo, sessionId: 's', signingKey: 'key' })
      const result = verifyBundle(bundle, { cwd: repo })
      expect(result.valid).toBe(false)
      expect(result.issues[0]).toContain('no signing key')
    })
  })

  describe('sha256', () => {
    it('produces consistent hashes', () => {
      expect(sha256('hello')).toBe(sha256('hello'))
      expect(sha256('hello')).not.toBe(sha256('world'))
    })

    it('produces 64-char hex string', () => {
      expect(sha256('test')).toHaveLength(64)
      expect(sha256('test')).toMatch(/^[0-9a-f]+$/)
    })
  })

  describe('signBundle', () => {
    it('produces different signatures for different keys', () => {
      const bundle = createBundle({ repositoryId: 'r', cwd: repo, sessionId: 's' })
      const sig1 = signBundle(bundle, 'key1')
      const sig2 = signBundle(bundle, 'key2')
      expect(sig1.value).not.toBe(sig2.value)
    })

    it('produces same signature for same bundle and key', () => {
      const bundle = createBundle({ repositoryId: 'r', cwd: repo, sessionId: 's' })
      const sig1 = signBundle(bundle, 'key')
      const sig2 = signBundle(bundle, 'key')
      expect(sig1.value).toBe(sig2.value)
    })
  })
})
