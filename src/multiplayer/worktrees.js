'use strict'

// Worktree Isolation — manage git worktrees for concurrent agent sessions.
// Each autonomous session gets its own worktree so file-level ownership
// conflicts are eliminated within a worktree boundary.

const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

/**
 * @typedef {object} WorktreeInfo
 * @property {string} path - absolute path to the worktree
 * @property {string} branch - branch checked out in the worktree
 * @property {string} head - HEAD commit SHA
 * @property {boolean} prunable - whether git considers it prunable
 */

/**
 * Create a git worktree for a session.
 *
 * @param {string} repoRoot main repository root
 * @param {string} branch branch name for the worktree
 * @param {object} [options]
 * @param {string} [options.basePath] directory under which worktrees are created
 * @param {boolean} [options.createBranch] create the branch if it doesn't exist
 * @returns {string} absolute path to the created worktree
 */
function createWorktree(repoRoot, branch, { basePath, createBranch = true } = {}) {
  const wtBase = basePath ?? path.join(repoRoot, '.octowiz', 'worktrees')
  const safeName = branch.replace(/[^\w-]/g, '_')
  const wtPath = path.join(wtBase, safeName)

  if (fs.existsSync(wtPath))
    throw new Error(`worktree already exists at ${wtPath}`)

  fs.mkdirSync(wtBase, { recursive: true })

  const args = ['worktree', 'add']
  if (createBranch)
    args.push('-b', branch)
  args.push(wtPath, ...(createBranch ? [] : [branch]))

  try {
    execFileSync('git', args, { cwd: repoRoot, stdio: 'pipe' })
  }
  catch (err) {
    // If branch already exists and createBranch was true, try without -b
    if (createBranch && err.stderr?.toString().includes('already exists')) {
      execFileSync('git', ['worktree', 'add', wtPath, branch], { cwd: repoRoot, stdio: 'pipe' })
    }
    else {
      throw new Error(`failed to create worktree: ${err.stderr?.toString().trim() || err.message}`)
    }
  }

  return wtPath
}

/**
 * List all git worktrees for a repository.
 *
 * @param {string} repoRoot
 * @returns {WorktreeInfo[]}
 */
function listWorktrees(repoRoot) {
  let output
  try {
    output = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' })
  }
  catch {
    return []
  }

  const worktrees = []
  let current = {}

  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current.path)
        worktrees.push(current)
      current = { path: line.slice(9), branch: '', head: '', prunable: false }
    }
    else if (line.startsWith('HEAD ')) {
      current.head = line.slice(5)
    }
    else if (line.startsWith('branch ')) {
      current.branch = line.slice(7).replace('refs/heads/', '')
    }
    else if (line === 'prunable') {
      current.prunable = true
    }
  }
  if (current.path)
    worktrees.push(current)

  return worktrees
}

/**
 * Remove a git worktree.
 *
 * @param {string} repoRoot
 * @param {string} wtPath absolute path to the worktree
 * @param {object} [options]
 * @param {boolean} [options.force] force removal even with uncommitted changes
 */
function removeWorktree(repoRoot, wtPath, { force = false } = {}) {
  const args = ['worktree', 'remove']
  if (force)
    args.push('--force')
  args.push(wtPath)

  try {
    execFileSync('git', args, { cwd: repoRoot, stdio: 'pipe' })
  }
  catch (err) {
    throw new Error(`failed to remove worktree: ${err.stderr?.toString().trim() || err.message}`)
  }
}

/**
 * Check if a path is inside a worktree managed by octowiz.
 * @param {string} repoRoot
 * @param {string} checkPath
 * @returns {boolean}
 */
function isOctowizWorktree(repoRoot, checkPath) {
  const wtBase = path.join(repoRoot, '.octowiz', 'worktrees')
  return path.resolve(checkPath).startsWith(path.resolve(wtBase))
}

/**
 * Find stale worktrees (those not linked to any active session).
 * @param {string} repoRoot
 * @param {string[]} activeWorktreePaths paths of worktrees with active sessions
 * @returns {WorktreeInfo[]}
 */
function findStaleWorktrees(repoRoot, activeWorktreePaths) {
  const all = listWorktrees(repoRoot)
  const wtBase = path.resolve(repoRoot, '.octowiz', 'worktrees')
  const activeSet = new Set(activeWorktreePaths.map(p => path.resolve(p)))

  return all.filter((wt) => {
    const resolved = path.resolve(wt.path)
    return resolved.startsWith(wtBase) && !activeSet.has(resolved)
  })
}

module.exports = {
  createWorktree,
  listWorktrees,
  removeWorktree,
  isOctowizWorktree,
  findStaleWorktrees,
}
