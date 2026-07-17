'use strict'

// CLI surface for runtime management. Provides `octowiz runtime` subcommands
// for listing available runtimes, showing the current selection, and setting
// a repository-local preference.

const { parseArgs } = require('node:util')

const { createClaudeCodeAdapter } = require('./claude-code')
const { createDaytonaAdapter } = require('./daytona')
const { createOpenCodeAdapter } = require('./opencode')
const { createRegistry } = require('./registry')
const { getPreferredRuntime, readRuntimeConfig, writeRuntimeConfig } = require('./selection')

const USAGE = `usage: octowiz runtime <command> [options]

commands:
  list               list all known runtimes and their availability
  select <id>        set the preferred runtime for this repository
  show               show the current runtime preference
  doctor             check Claude Code advisor/workflow readiness

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
 * Create the default registry with all known adapters.
 * @returns {import('./registry').RuntimeRegistry}
 */
function createDefaultRegistry() {
  const registry = createRegistry()
  registry.register(createClaudeCodeAdapter())
  registry.register(createOpenCodeAdapter())
  registry.register(createDaytonaAdapter())
  return registry
}

const KNOWN_RUNTIME_IDS = ['claude-code', 'opencode', 'daytona']

const COMMANDS = {
  list: async (argv, cwd) => {
    const { values } = parse(argv)
    const registry = createDefaultRegistry()
    const preferred = getPreferredRuntime({ cwd })

    const results = []
    for (const id of registry.ids()) {
      const adapter = registry.get(id)
      let available = false
      try {
        available = await Promise.race([
          adapter.isAvailable(),
          new Promise(resolve => setTimeout(resolve, 2000, false)),
        ])
      }
      catch {
        // unavailable
      }
      results.push({
        id: adapter.id,
        name: adapter.name,
        available,
        preferred: adapter.id === preferred,
      })
    }

    const data = results
    const human = results.map(r =>
      `${r.preferred ? '→' : ' '} ${r.id.padEnd(14)} ${r.name.padEnd(14)} ${r.available ? '✓ available' : '✗ unavailable'}`,
    ).join('\n')

    return { values, data, human }
  },

  doctor: (argv) => {
    const { values } = parse(argv)
    const { inspectClaudeCode } = require('./doctor')
    const data = inspectClaudeCode()
    const human = [
      `Claude Code: ${data.available ? data.version : 'not available'}`,
      `advisor: ${data.advisorReady ? 'ready (fable)' : `not ready (${data.advisorModel ?? 'not configured'})`}`,
      `workflows: ${data.workflowCapable && !data.workflowsDisabled ? 'ready' : 'not ready'}`,
      `overall: ${data.ready ? 'ready' : 'configuration required'}`,
    ].join('\n')
    return { values, data, human }
  },

  show: (argv, cwd) => {
    const { values } = parse(argv)
    const config = readRuntimeConfig(cwd)
    const preferred = getPreferredRuntime({ cwd })
    const data = { preferred, configured: config?.preferred ?? null }
    const human = config?.preferred
      ? `preferred runtime: ${preferred} (configured in .octowiz/config.json)`
      : `preferred runtime: ${preferred} (default)`
    return { values, data, human }
  },

  select: (argv, cwd) => {
    const { values, positionals } = parse(argv)
    const id = positionals[0]
    if (!id) {
      return { values, error: true, human: 'error: select requires a runtime id', data: { error: { code: 'E_USAGE', message: 'select requires a runtime id' } } }
    }
    if (!KNOWN_RUNTIME_IDS.includes(id)) {
      return { values, error: true, human: `error: unknown runtime '${id}' (known: ${KNOWN_RUNTIME_IDS.join(', ')})`, data: { error: { code: 'E_UNKNOWN_RUNTIME', message: `unknown runtime: ${id}` } } }
    }

    const config = readRuntimeConfig(cwd) || {}
    config.preferred = id
    writeRuntimeConfig(cwd, config)

    const data = { preferred: id }
    const human = `runtime preference set to: ${id}`
    return { values, data, human }
  },
}

/**
 * Runs one `octowiz runtime ...` invocation.
 * @param {string[]} argv arguments after "runtime"
 * @param {object} [io]
 * @param {string} [io.cwd]
 * @param {(line: string) => void} [io.stdout]
 * @param {(line: string) => void} [io.stderr]
 * @returns {Promise<number>} exit code
 */
async function runRuntime(argv, { cwd = process.cwd(), stdout = console.log, stderr = console.error } = {}) {
  const [command, ...rest] = argv

  if (!command || command === 'help' || command === '--help') {
    stdout(USAGE)
    return command ? 0 : 1
  }

  const handler = COMMANDS[command]
  if (!handler) {
    stderr(`unknown runtime command: ${command}\n\n${USAGE}`)
    return 1
  }

  try {
    const result = await handler(rest, cwd)
    const { values, data, human, error } = result
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

module.exports = { runRuntime, USAGE, createDefaultRegistry, KNOWN_RUNTIME_IDS }
