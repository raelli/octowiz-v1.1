'use strict'

const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const MIN_WORKFLOW_VERSION = [2, 1, 203]

function _parseVersion(raw) {
  const match = String(raw).match(/(\d+)\.(\d+)\.(\d+)/)
  return match ? match.slice(1).map(Number) : null
}

function _atLeast(actual, minimum) {
  if (!actual)
    return false
  for (let i = 0; i < minimum.length; i++) {
    if (actual[i] > minimum[i])
      return true
    if (actual[i] < minimum[i])
      return false
  }
  return true
}

function inspectClaudeCode({ home = os.homedir(), run = execFileSync } = {}) {
  let version = null
  try {
    version = String(run('claude', ['--version'], { encoding: 'utf8' })).trim()
  }
  catch {
    // Report unavailable below.
  }

  let settings = {}
  const settingsPath = path.join(home, '.claude', 'settings.json')
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
  }
  catch {
    // Missing or invalid settings are reported without exposing other values.
  }

  const parsed = _parseVersion(version)
  return {
    available: Boolean(version),
    version,
    workflowCapable: _atLeast(parsed, MIN_WORKFLOW_VERSION),
    advisorModel: settings.advisorModel ?? null,
    advisorReady: settings.advisorModel === 'fable',
    workflowsDisabled: settings.disableWorkflows === true,
    ready: Boolean(version) && _atLeast(parsed, MIN_WORKFLOW_VERSION)
      && settings.advisorModel === 'fable' && settings.disableWorkflows !== true,
  }
}

module.exports = { inspectClaudeCode }
