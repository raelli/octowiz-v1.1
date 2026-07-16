'use strict'

// Derives a machine-independent repository identity. The ID lands in the
// committed state file, so it must never contain local absolute paths.
//
// Forms:
//   github:owner/repo      — from a github.com remote
//   git:host/owner/repo    — from any other git remote
//   local:<basename>       — no usable remote (still portable: no full path)

const { execFileSync } = require('node:child_process')
const path = require('node:path')

function gitRemoteUrl(cwd) {
  try {
    return execFileSync('git', ['-C', cwd, 'remote', 'get-url', 'origin'], {
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  }
  catch {
    return ''
  }
}

// Parses https, ssh and scp-like git remotes into { host, ownerRepo }.
function parseRemote(url) {
  if (!url)
    return null
  const scpLike = url.match(/^(?:[\w.-]+@)?([\w.-]+):(.+)$/)
  try {
    const u = new URL(url)
    if (u.hostname && u.pathname.length > 1)
      return { host: u.hostname, ownerRepo: u.pathname.replace(/^\/+/, '') }
  }
  catch {}
  if (scpLike)
    return { host: scpLike[1], ownerRepo: scpLike[2] }
  return null
}

function deriveRepositoryId(cwd) {
  const parsed = parseRemote(gitRemoteUrl(cwd))
  if (parsed) {
    const ownerRepo = parsed.ownerRepo.replace(/\.git$/, '').replace(/\/+$/, '')
    if (ownerRepo) {
      return parsed.host === 'github.com'
        ? `github:${ownerRepo}`
        : `git:${parsed.host}/${ownerRepo}`
    }
  }
  return `local:${path.basename(path.resolve(cwd))}`
}

// Filesystem-safe slug for the machine-local runtime directory.
function repositoryIdSlug(repositoryId) {
  return String(repositoryId).replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '')
}

module.exports = { deriveRepositoryId, repositoryIdSlug }
