'use strict'

// Shared fixtures for the engineering-state suites: a throwaway git repo per
// test and an isolated runtime dir so nothing touches the developer's real
// ~/.cache/octowiz.

const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

function makeTempRepo({ git = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'octowiz-state-'))
  if (git)
    execFileSync('git', ['-C', dir, 'init', '-q'])
  return dir
}

function isolateRuntimeDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'octowiz-runtime-'))
  const previous = process.env.OCTOWIZ_RUNTIME_DIR
  process.env.OCTOWIZ_RUNTIME_DIR = dir
  return () => {
    if (previous === undefined)
      delete process.env.OCTOWIZ_RUNTIME_DIR
    else process.env.OCTOWIZ_RUNTIME_DIR = previous
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true })
}

// Brings a fresh state to `implement` with goal/artifact/criterion in place.
function toImplement(store, operations, transitions, cwd) {
  store.init(cwd)
  store.mutate(cwd, doc => operations.setGoal(doc, 'ship the feature'))
  store.mutate(cwd, doc => operations.linkArtifact(doc, { type: 'issue', id: 'issue-1' }))
  store.mutate(cwd, doc => operations.addCriterion(doc, { statement: 'it works', id: 'ac-1' }))
  store.mutate(cwd, doc => transitions.transitionTo(doc, 'define'))
  store.mutate(cwd, doc => transitions.transitionTo(doc, 'plan'))
  return store.mutate(cwd, doc => transitions.transitionTo(doc, 'implement'))
}

module.exports = { makeTempRepo, isolateRuntimeDir, cleanup, toImplement }
