'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { parseArgs } = require('node:util')

const WORKFLOWS = ['integra-audit', 'integra-migration']
const USAGE = `usage: octowiz workflow <command> [options]

commands:
  list                         list bundled workflow templates
  install <name|all>           install templates explicitly

install options:
  --scope project|user         destination scope (default: project)
  --dry-run                    preview without writing
  --force                      replace an existing workflow
  --json`

function _parse(argv, options = {}) {
  return parseArgs({
    args: argv,
    options: {
      json: { type: 'boolean', default: false },
      ...options,
    },
    allowPositionals: true,
  })
}

function _source(name) {
  return path.resolve(__dirname, '..', '..', 'workflows', `${name}.js`)
}

function _destination(name, scope, cwd, home) {
  const root = scope === 'user'
    ? path.join(home, '.claude', 'workflows')
    : path.join(cwd, '.claude', 'workflows')
  return path.join(root, `${name}.js`)
}

function installWorkflows(names, {
  cwd = process.cwd(),
  home = os.homedir(),
  scope = 'project',
  dryRun = false,
  force = false,
} = {}) {
  if (!['project', 'user'].includes(scope))
    throw new Error('--scope must be project or user')

  const selected = names.includes('all') ? WORKFLOWS : names
  if (selected.length === 0)
    throw new Error('install requires a workflow name or all')
  for (const name of selected) {
    if (!WORKFLOWS.includes(name))
      throw new Error(`unknown workflow '${name}'`)
  }

  return selected.map((name) => {
    const source = _source(name)
    const destination = _destination(name, scope, cwd, home)
    const exists = fs.existsSync(destination)
    if (exists && !force)
      throw new Error(`workflow already exists at ${destination}; pass --force to replace it`)
    if (!dryRun) {
      fs.mkdirSync(path.dirname(destination), { recursive: true })
      fs.copyFileSync(source, destination)
    }
    return { name, source, destination, scope, installed: !dryRun, replaced: exists }
  })
}

function runWorkflow(argv, {
  cwd = process.cwd(),
  home = os.homedir(),
  stdout = console.log,
  stderr = console.error,
} = {}) {
  const [command, ...rest] = argv
  if (!command || command === 'help' || command === '--help') {
    stdout(USAGE)
    return command ? 0 : 1
  }

  try {
    if (command === 'list') {
      const { values } = _parse(rest)
      const data = WORKFLOWS.map(name => ({ name, source: _source(name) }))
      stdout(values.json ? JSON.stringify(data, null, 2) : data.map(item => item.name).join('\n'))
      return 0
    }
    if (command === 'install') {
      const { values, positionals } = _parse(rest, {
        scope: { type: 'string', default: 'project' },
        'dry-run': { type: 'boolean', default: false },
        force: { type: 'boolean', default: false },
      })
      const data = installWorkflows(positionals, {
        cwd,
        home,
        scope: values.scope,
        dryRun: values['dry-run'],
        force: values.force,
      })
      const human = data.map(item =>
        `${item.installed ? 'installed' : 'would install'} ${item.name} -> ${item.destination}`,
      ).join('\n')
      stdout(values.json ? JSON.stringify(data, null, 2) : human)
      return 0
    }
    stderr(`unknown workflow command: ${command}\n\n${USAGE}`)
    return 1
  }
  catch (error) {
    const wantsJson = argv.includes('--json')
    stderr(wantsJson
      ? JSON.stringify({ error: { code: 'E_WORKFLOW', message: error.message } }, null, 2)
      : `error: ${error.message}`)
    return 1
  }
}

module.exports = { installWorkflows, runWorkflow, WORKFLOWS, USAGE }
