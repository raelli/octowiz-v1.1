'use strict'

const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { createConflictDetector, findOverlappingFiles } = require('../../src/multiplayer/conflicts')

function makeGitRepo() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'octowiz-cf-')))
  execFileSync('git', ['-C', dir, 'init', '-q'])
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'test@test.com'])
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'Test'])
  fs.writeFileSync(path.join(dir, 'base.txt'), 'base\n')
  execFileSync('git', ['-C', dir, 'add', '.'])
  execFileSync('git', ['-C', dir, 'commit', '-m', 'init', '-q'])
  const baseBranch = execFileSync('git', ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim()
  return { dir, baseBranch }
}

describe('conflict detector', () => {
  let detector

  beforeEach(() => { detector = createConflictDetector() })

  describe('recordModification', () => {
    it('records file modifications for a session', () => {
      detector.recordModification('s1', 'src/a.js')
      expect(detector.filesForSession('s1')).toEqual(['src/a.js'])
    })

    it('records multiple files', () => {
      detector.recordModifications('s1', ['a.js', 'b.js'])
      expect(detector.filesForSession('s1').sort()).toEqual(['a.js', 'b.js'])
    })
  })

  describe('detectOverlaps', () => {
    it('returns empty when no overlaps', () => {
      detector.recordModification('s1', 'a.js')
      detector.recordModification('s2', 'b.js')
      expect(detector.detectOverlaps()).toEqual([])
    })

    it('detects file modified by multiple sessions', () => {
      detector.recordModification('s1', 'shared.js')
      detector.recordModification('s2', 'shared.js')
      const overlaps = detector.detectOverlaps()
      expect(overlaps).toHaveLength(1)
      expect(overlaps[0].file).toBe('shared.js')
      expect(overlaps[0].sessions.sort()).toEqual(['s1', 's2'])
    })

    it('detects multiple overlapping files', () => {
      detector.recordModifications('s1', ['a.js', 'b.js'])
      detector.recordModifications('s2', ['b.js', 'c.js'])
      detector.recordModifications('s3', ['a.js'])
      const overlaps = detector.detectOverlaps()
      expect(overlaps).toHaveLength(2)
    })
  })

  describe('conflictsForSession', () => {
    it('returns conflicts involving a specific session', () => {
      detector.recordModification('s1', 'shared.js')
      detector.recordModification('s2', 'shared.js')
      detector.recordModification('s1', 'only-s1.js')
      const conflicts = detector.conflictsForSession('s1')
      expect(conflicts).toHaveLength(1)
      expect(conflicts[0].file).toBe('shared.js')
      expect(conflicts[0].sessions).toEqual(['s2'])
    })

    it('returns empty when no conflicts for session', () => {
      detector.recordModification('s1', 'a.js')
      detector.recordModification('s2', 'b.js')
      expect(detector.conflictsForSession('s1')).toEqual([])
    })
  })

  describe('validateBeforeModify', () => {
    it('returns conflicts without recording', () => {
      detector.recordModification('s1', 'shared.js')
      const conflicts = detector.validateBeforeModify('s2', ['shared.js'])
      expect(conflicts).toHaveLength(1)
      // Should not have recorded s2's modification
      expect(detector.filesForSession('s2')).toEqual([])
    })

    it('returns empty when no conflict would result', () => {
      detector.recordModification('s1', 'a.js')
      expect(detector.validateBeforeModify('s2', ['b.js'])).toEqual([])
    })
  })

  describe('strict mode', () => {
    it('throws on conflict in validateBeforeModify', () => {
      const strict = createConflictDetector({ strict: true })
      strict.recordModification('s1', 'shared.js')
      expect(() => strict.validateBeforeModify('s2', ['shared.js'])).toThrow(/conflict detected/)
    })

    it('does not throw when no conflict', () => {
      const strict = createConflictDetector({ strict: true })
      strict.recordModification('s1', 'a.js')
      expect(() => strict.validateBeforeModify('s2', ['b.js'])).not.toThrow()
    })
  })

  describe('clearSession', () => {
    it('removes all modifications for a session', () => {
      detector.recordModifications('s1', ['a.js', 'b.js'])
      detector.recordModification('s2', 'a.js')
      detector.clearSession('s1')
      expect(detector.filesForSession('s1')).toEqual([])
      expect(detector.detectOverlaps()).toEqual([])
    })
  })

  describe('clear', () => {
    it('removes all modifications', () => {
      detector.recordModification('s1', 'a.js')
      detector.recordModification('s2', 'b.js')
      detector.clear()
      expect(detector.detectOverlaps()).toEqual([])
      expect(detector.filesForSession('s1')).toEqual([])
    })
  })
})

describe('findOverlappingFiles', () => {
  let repo
  let baseBranch

  beforeEach(() => {
    const created = makeGitRepo()
    repo = created.dir
    baseBranch = created.baseBranch
  })
  afterEach(() => { fs.rmSync(repo, { recursive: true, force: true }) })

  it('finds files modified in both branches', () => {
    // Create branch1 with a change
    execFileSync('git', ['-C', repo, 'checkout', '-b', 'branch1', '-q'])
    fs.writeFileSync(path.join(repo, 'shared.txt'), 'branch1\n')
    fs.writeFileSync(path.join(repo, 'only1.txt'), 'only1\n')
    execFileSync('git', ['-C', repo, 'add', '.'])
    execFileSync('git', ['-C', repo, 'commit', '-m', 'b1', '-q'])

    // Create branch2 from the repo default branch with overlapping change
    execFileSync('git', ['-C', repo, 'checkout', baseBranch, '-q'])
    execFileSync('git', ['-C', repo, 'checkout', '-b', 'branch2', '-q'])
    fs.writeFileSync(path.join(repo, 'shared.txt'), 'branch2\n')
    fs.writeFileSync(path.join(repo, 'only2.txt'), 'only2\n')
    execFileSync('git', ['-C', repo, 'add', '.'])
    execFileSync('git', ['-C', repo, 'commit', '-m', 'b2', '-q'])

    const overlapping = findOverlappingFiles(repo, 'branch1', 'branch2')
    expect(overlapping).toEqual(['shared.txt'])
  })

  it('returns empty when no overlap', () => {
    execFileSync('git', ['-C', repo, 'checkout', '-b', 'b1', '-q'])
    fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n')
    execFileSync('git', ['-C', repo, 'add', '.'])
    execFileSync('git', ['-C', repo, 'commit', '-m', 'a', '-q'])

    execFileSync('git', ['-C', repo, 'checkout', 'main', '-q'])
    execFileSync('git', ['-C', repo, 'checkout', '-b', 'b2', '-q'])
    fs.writeFileSync(path.join(repo, 'b.txt'), 'b\n')
    execFileSync('git', ['-C', repo, 'add', '.'])
    execFileSync('git', ['-C', repo, 'commit', '-m', 'b', '-q'])

    expect(findOverlappingFiles(repo, 'b1', 'b2')).toEqual([])
  })
})
