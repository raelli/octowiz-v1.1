'use strict'

// Signed Evidence Bundles — produce and verify tamper-evident bundles that
// tie engineering evidence to a specific commit and session. Optional
// HMAC-SHA256 signing when a key is configured.

const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')

const BUNDLE_VERSION = '0.1'
const SIGNATURE_ALGORITHM = 'hmac-sha256'

/**
 * @typedef {object} EvidenceBundle
 * @property {string} bundleVersion
 * @property {string} repositoryId
 * @property {string} commit - short SHA
 * @property {string} commitSha256 - SHA-256 hash of the full commit SHA
 * @property {string} session - session id that produced the evidence
 * @property {string} runtime - runtime adapter id
 * @property {string} timestamp - ISO-8601
 * @property {Array<{kind: string, status: string, ref: string}>} evidence
 * @property {Array<{id: string, status: string}>} criteria
 * @property {{algorithm: string, keyId: string, value: string}|null} signature
 */

/**
 * Get the current HEAD commit SHA for a repository.
 * @param {string} cwd
 * @returns {string}
 */
function getCurrentCommit(cwd) {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim()
}

/**
 * Compute SHA-256 of a string.
 * @param {string} input
 * @returns {string} hex digest
 */
function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex')
}

/**
 * Create an evidence bundle from state and commit.
 *
 * @param {object} options
 * @param {string} options.repositoryId
 * @param {string} options.cwd - repository root
 * @param {string} options.sessionId
 * @param {string} [options.runtime]
 * @param {Array<{kind: string, status: string, ref?: string}>} [options.evidence]
 * @param {Array<{id: string, status: string}>} [options.criteria]
 * @param {string} [options.signingKey] HMAC key for signing (null = unsigned)
 * @param {string} [options.keyId] key identifier for the signature
 * @returns {EvidenceBundle}
 */
function createBundle({
  repositoryId,
  cwd,
  sessionId,
  runtime = 'claude-code',
  evidence = [],
  criteria = [],
  signingKey = null,
  keyId = 'local-machine-key',
}) {
  const commit = getCurrentCommit(cwd)
  const commitSha256 = sha256(commit)

  const bundle = {
    bundleVersion: BUNDLE_VERSION,
    repositoryId,
    commit: commit.slice(0, 12),
    commitSha256,
    session: sessionId,
    runtime,
    timestamp: new Date().toISOString(),
    evidence: evidence.map(e => ({
      kind: e.kind,
      status: e.status,
      ref: e.ref ?? '',
    })),
    criteria: criteria.map(c => ({
      id: c.id,
      status: c.status,
    })),
    signature: null,
  }

  if (signingKey) {
    bundle.signature = signBundle(bundle, signingKey, keyId)
  }

  return bundle
}

/**
 * Sign a bundle using HMAC-SHA256.
 * The signature covers all fields except the signature itself.
 *
 * @param {object} bundle
 * @param {string} key
 * @param {string} keyId
 * @returns {{algorithm: string, keyId: string, value: string}}
 */
function signBundle(bundle, key, keyId = 'local-machine-key') {
  const payload = JSON.stringify({ ...bundle, signature: null })
  const value = crypto.createHmac('sha256', key).update(payload).digest('hex')
  return { algorithm: SIGNATURE_ALGORITHM, keyId, value }
}

/**
 * Verify a bundle's integrity.
 *
 * Checks:
 * 1. commitSha256 matches sha256(full commit) if cwd is provided
 * 2. Signature is valid (when signing key is provided and bundle is signed)
 *
 * @param {EvidenceBundle} bundle
 * @param {object} [options]
 * @param {string} [options.cwd] repository root for commit verification
 * @param {string} [options.signingKey] key for signature verification
 * @returns {{ valid: boolean, issues: string[] }}
 */
function verifyBundle(bundle, { cwd, signingKey } = {}) {
  const issues = []

  // Structural checks
  if (bundle.bundleVersion !== BUNDLE_VERSION)
    issues.push(`unsupported bundle version: ${bundle.bundleVersion}`)

  if (!bundle.commitSha256 || typeof bundle.commitSha256 !== 'string')
    issues.push('missing commitSha256')

  // Commit integrity check
  if (cwd && bundle.commitSha256) {
    try {
      const currentCommit = getCurrentCommit(cwd)
      const expectedHash = sha256(currentCommit)
      if (expectedHash !== bundle.commitSha256)
        issues.push(`commit hash mismatch: bundle references a different commit than HEAD`)
    }
    catch (err) {
      issues.push(`cannot verify commit: ${err.message}`)
    }
  }

  // Signature verification
  if (bundle.signature && signingKey) {
    const expected = signBundle(bundle, signingKey, bundle.signature.keyId)
    if (expected.value !== bundle.signature.value)
      issues.push('signature verification failed: bundle may have been tampered with')
  }
  else if (bundle.signature && !signingKey) {
    issues.push('bundle is signed but no signing key provided for verification')
  }

  return { valid: issues.length === 0, issues }
}

module.exports = {
  BUNDLE_VERSION,
  SIGNATURE_ALGORITHM,
  createBundle,
  signBundle,
  verifyBundle,
  sha256,
  getCurrentCommit,
}
