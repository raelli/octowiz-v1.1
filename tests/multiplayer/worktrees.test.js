'use strict'

const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { createWorktree, listWorktrees, removeWorktree, isOctowizWorktree, findStaleWorktrees } = require('../../src/multiplayer/worktrees')

function makeGitRepo() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'octowiz-wt-')))
  execFileSync('git', ['-C', dir, 'init', '-q'])
  execFileSync('git', ['-C', dir, 'commit', '--allow-empty', '-m', 'init', '-q'])
  return dir
}

describe('worktree isolation', () => {
  let repo

  beforeEach(() => { repo = makeGitRepo() })
  afterEach(() => { fs.rmSync(repo, { recursive: true, force: true }) })

  describe('createWorktree', () => {
    it('creates a worktree with a new branch', () => {
      const wtPath = createWorktree(repo, 'feat/test-wt')
      expect(fs.existsSync(wtPath)).toBe(true)
      expect(fs.existsSync(path.join(wtPath, '.git'))).toBe(true)
    })

    it('creates worktree under .octowiz/worktrees by default', () => {
      const wtPath = createWorktree(repo, 'feat/wt1')
      expect(wtPath).toContain('.octowiz/worktrees')
    })

    it('throws if worktree path already exists', () => {
      createWorktree(repo, 'feat/dup')
      expect(() => createWorktree(repo, 'feat/dup')).toThrow(/already exists/)
    })

    it('uses custom basePath', () => {
      const custom = path.join(repo, 'custom-wt')
      const wtPath = createWorktree(repo, 'feat/custom', { basePath: custom })
      expect(wtPath.startsWith(custom)).toBe(true)
    })
  })

  describe('listWorktrees', () => {
    it('lists the main worktree', () => {
      const list = listWorktrees(repo)
      expect(list.length).toBeGreaterThanOrEqual(1)
      expect(list[0].path).toBe(repo)
    })

    it('includes created worktrees', () => {
      createWorktree(repo, 'feat/listed')
      const list = listWorktrees(repo)
      expect(list.length).toBe(2)
      expect(list.some(w => w.branch === 'feat/listed')).toBe(true)
    })
  })

  describe('removeWorktree', () => {
    it('removes an existing worktree', () => {
      const wtPath = createWorktree(repo, 'feat/removable')
      removeWorktree(repo, wtPath)
      expect(fs.existsSync(wtPath)).toBe(false)
    })

    it('throws for non-existent worktree', () => {
      expect(() => removeWorktree(repo, '/nonexistent')).toThrow()
    })

    it('force removes with uncommitted changes', () => {
      const wtPath = createWorktree(repo, 'feat/dirty')
      fs.writeFileSync(path.join(wtPath, 'dirty.txt'), 'change')
      removeWorktree(repo, wtPath, { force: true })
      expect(fs.existsSync(wtPath)).toBe(false)
    })
  })

  describe('isOctowizWorktree', () => {
    it('returns true for paths under .octowiz/worktrees', () => {
      const wtPath = createWorktree(repo, 'feat/check')
      expect(isOctowizWorktree(repo, wtPath)).toBe(true)
    })

    it('returns false for the main repo', () => {
      expect(isOctowizWorktree(repo, repo)).toBe(false)
    })

    it('returns false for arbitrary paths', () => {
      expect(isOctowizWorktree(repo, '/tmp/random')).toBe(false)
    })
  })

  describe('findStaleWorktrees', () => {
    it('finds worktrees not in active list', () => {
      const wt1 = createWorktree(repo, 'feat/active')
      const wt2 = createWorktree(repo, 'feat/stale')
      const stale = findStaleWorktrees(repo, [wt1])
      expect(stale).toHaveLength(1)
      expect(stale[0].path).toBe(wt2)
    })

    it('returns empty when all worktrees are active', () => {
      const wt1 = createWorktree(repo, 'feat/a')
      const stale = findStaleWorktrees(repo, [wt1])
      expect(stale).toHaveLength(0)
    })
  })
})
