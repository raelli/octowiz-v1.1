'use strict'

// Conflict Detection — detect overlapping changes across sessions/worktrees.
// Tracks file modifications per session and warns when concurrent edits
// target the same logical area. Supports advisory and strict modes.

const { execFileSync } = require('node:child_process')

/**
 * @typedef {object} FileConflict
 * @property {string} file - conflicting file path
 * @property {string[]} sessions - session ids that have modified the file
 */

/**
 * @typedef {object} MergeConflict
 * @property {string} file - file with textual conflict
 * @property {string} source - source branch/ref
 * @property {string} target - target branch/ref
 */

/**
 * Create a conflict detector.
 *
 * @param {object} [options]
 * @param {boolean} [options.strict] if true, conflicts block; if false, advisory only
 * @returns {ConflictDetector}
 */
function createConflictDetector({ strict = false } = {}) {
  /** @type {Map<string, Set<string>>} file → set of session ids */
  const modifications = new Map()

  /**
   * Record that a session modified a file.
   * @param {string} sessionId
   * @param {string} file
   */
  function recordModification(sessionId, file) {
    if (!modifications.has(file))
      modifications.set(file, new Set())
    modifications.get(file).add(sessionId)
  }

  /**
   * Record multiple modifications at once.
   * @param {string} sessionId
   * @param {string[]} files
   */
  function recordModifications(sessionId, files) {
    for (const file of files)
      recordModification(sessionId, file)
  }

  /**
   * Check for file-level overlaps between sessions.
   * Returns files that have been modified by more than one session.
   *
   * @returns {FileConflict[]}
   */
  function detectOverlaps() {
    const conflicts = []
    for (const [file, sessions] of modifications) {
      if (sessions.size > 1)
        conflicts.push({ file, sessions: [...sessions] })
    }
    return conflicts
  }

  /**
   * Check if a specific session's modifications conflict with others.
   * @param {string} sessionId
   * @returns {FileConflict[]}
   */
  function conflictsForSession(sessionId) {
    const conflicts = []
    for (const [file, sessions] of modifications) {
      if (sessions.has(sessionId) && sessions.size > 1)
        conflicts.push({ file, sessions: [...sessions].filter(s => s !== sessionId) })
    }
    return conflicts
  }

  /**
   * Validate that recording a modification would not cause a conflict.
   * In strict mode, throws if a conflict would result.
   *
   * @param {string} sessionId
   * @param {string[]} files
   * @returns {FileConflict[]} conflicts that would result
   * @throws {Error} in strict mode when conflicts exist
   */
  function validateBeforeModify(sessionId, files) {
    const conflicts = []
    for (const file of files) {
      const existing = modifications.get(file)
      if (existing && existing.size > 0) {
        const others = [...existing].filter(s => s !== sessionId)
        if (others.length > 0)
          conflicts.push({ file, sessions: others })
      }
    }

    if (strict && conflicts.length > 0) {
      const detail = conflicts.map(c => `${c.file} (modified by ${c.sessions.join(', ')})`).join('; ')
      throw new Error(`conflict detected in strict mode: ${detail}`)
    }

    return conflicts
  }

  /**
   * Clear all recorded modifications for a session (e.g., on session end).
   * @param {string} sessionId
   */
  function clearSession(sessionId) {
    for (const [file, sessions] of modifications) {
      sessions.delete(sessionId)
      if (sessions.size === 0)
        modifications.delete(file)
    }
  }

  /**
   * Clear all recorded modifications.
   */
  function clear() {
    modifications.clear()
  }

  /**
   * Get all files modified by a specific session.
   * @param {string} sessionId
   * @returns {string[]}
   */
  function filesForSession(sessionId) {
    const files = []
    for (const [file, sessions] of modifications) {
      if (sessions.has(sessionId))
        files.push(file)
    }
    return files
  }

  return {
    recordModification,
    recordModifications,
    detectOverlaps,
    conflictsForSession,
    validateBeforeModify,
    clearSession,
    clear,
    filesForSession,
  }
}

/**
 * Pre-merge conflict check using git merge-tree.
 * Detects textual conflicts before attempting an actual merge.
 *
 * @param {string} repoRoot
 * @param {string} source source branch/ref
 * @param {string} target target branch/ref
 * @returns {MergeConflict[]}
 */
function checkMergeConflicts(repoRoot, source, target) {
  try {
    // git merge-tree --write-tree produces output with conflict markers
    execFileSync('git', ['merge-tree', '--write-tree', '--no-messages', source, target], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    // Exit code 0 means no conflicts
    return []
  }
  catch (err) {
    // Non-zero exit means conflicts exist
    const output = err.stdout?.toString() || ''
    const conflicts = []
    // Parse conflict file list from merge-tree output
    for (const line of output.split('\n')) {
      if (line.trim() && !line.startsWith('#'))
        conflicts.push({ file: line.trim(), source, target })
    }
    // If we couldn't parse specific files, return a generic conflict
    if (conflicts.length === 0 && err.status !== 0)
      conflicts.push({ file: '(merge conflict detected)', source, target })
    return conflicts
  }
}

/**
 * Simpler conflict check: compare changed files between two refs.
 * Returns files modified in both branches since their common ancestor.
 *
 * @param {string} repoRoot
 * @param {string} branch1
 * @param {string} branch2
 * @returns {string[]} files modified in both branches
 */
function findOverlappingFiles(repoRoot, branch1, branch2) {
  try {
    const base = execFileSync('git', ['merge-base', branch1, branch2], {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim()

    const files1 = execFileSync('git', ['diff', '--name-only', base, branch1], {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim().split('\n').filter(Boolean)

    const files2 = execFileSync('git', ['diff', '--name-only', base, branch2], {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim().split('\n').filter(Boolean)

    const set1 = new Set(files1)
    return files2.filter(f => set1.has(f))
  }
  catch {
    return []
  }
}

module.exports = {
  createConflictDetector,
  checkMergeConflicts,
  findOverlappingFiles,
}
