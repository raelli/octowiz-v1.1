'use strict'

// CLI surface for the capability registry. Provides `octowiz capability`
// subcommands for resolving and listing capabilities from the registry.

const path = require('node:path')
const { parseArgs } = require('node:util')

const { loadRegistryWithOverrides, resolveWithConditions, resolveAllWithConditions } = require('./registry')

const USAGE = `usage: octowiz capability <command> [options]

commands:
  resolve <name>     resolve a capability to its provider and command
  list               list all capabilities and their current resolution

global options: --json`

function parse(argv, options = {}) {
  return parseArgs({
    args: argv,
    options: {
      json: { type: 'boolean', default: false },
      ...options,
    },
    allowPositionals: true,
  })
}

/**
 * Load the merged registry (default + local overrides if present at cwd).
 * @param {string} cwd
 * @returns {object} The resulting value.
 */
function loadMergedRegistry(cwd) {
  const overridesPath = path.resolve(cwd, '.octowiz', 'capabilities.json')
  return loadRegistryWithOverrides({ overridesPath })
}

const COMMANDS = {
  resolve: (argv, cwd) => {
    const { values, positionals } = parse(argv)
    const name = positionals[0]
    if (!name) {
      return { values, error: true, human: 'error: resolve requires a capability name', data: { error: { code: 'E_USAGE', message: 'resolve requires a capability name' } } }
    }

    const registry = loadMergedRegistry(cwd)
    const resolved = resolveWithConditions(registry, name, cwd)

    if (!resolved) {
      const data = { capability: name, resolved: null }
      return { values, data, human: `${name}: no resolver qualifies in this context` }
    }

    const data = { capability: name, resolved: { provider: resolved.provider, command: resolved.command, role: resolved.role } }
    const human = `${name} → ${resolved.provider}:${resolved.command} [${resolved.role}]`
    return { values, data, human }
  },

  list: (argv, cwd) => {
    const { values } = parse(argv)
    const registry = loadMergedRegistry(cwd)
    const all = resolveAllWithConditions(registry, cwd)
    const data = {}
    const lines = []

    for (const [name, resolved] of all) {
      if (resolved) {
        data[name] = { provider: resolved.provider, command: resolved.command, role: resolved.role }
        lines.push(`${name} → ${resolved.provider}:${resolved.command} [${resolved.role}]`)
      }
      else {
        data[name] = null
        lines.push(`${name} → (unresolved)`)
      }
    }

    return { values, data, human: lines.join('\n') }
  },
}

/**
 * Runs one `octowiz capability ...` invocation without exiting the process.
 * @param {string[]} argv arguments after "capability"
 * @param {object} [io]
 * @param {string} [io.cwd]
 * @param {(line: string) => void} [io.stdout]
 * @param {(line: string) => void} [io.stderr]
 * @returns {number} exit code
 */
function runCapability(argv, { cwd = process.cwd(), stdout = console.log, stderr = console.error } = {}) {
  const [command, ...rest] = argv

  if (!command || command === 'help' || command === '--help') {
    stdout(USAGE)
    return command ? 0 : 1
  }

  const handler = COMMANDS[command]
  if (!handler) {
    stderr(`unknown capability command: ${command}\n\n${USAGE}`)
    return 1
  }

  try {
    const { values, data, human, error } = handler(rest, cwd)
    if (error) {
      stderr(values.json ? JSON.stringify(data, null, 2) : human)
      return 1
    }
    stdout(values.json ? JSON.stringify(data, null, 2) : human)
    return 0
  }
  catch (err) {
    const wantsJson = argv.includes('--json')
    stderr(wantsJson
      ? JSON.stringify({ error: { code: 'E_UNEXPECTED', message: err.message } }, null, 2)
      : `error: ${err.message}`)
    return 1
  }
}

module.exports = { runCapability, USAGE }
