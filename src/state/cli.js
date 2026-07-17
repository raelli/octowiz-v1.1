'use strict'

// Deterministic CLI over the engineering state. Agents and humans mutate
// state through these commands — never by editing state.json directly. Every
// command supports --json for machine consumption (this is also the explicit
// interface the Python side reads state through).

const { parseArgs } = require('node:util')

const { StateError } = require('./errors')
const { resolveNextAction } = require('./next')
const operations = require('./operations')
const { runtimeFileInsideRepo } = require('./runtime')
const { LEAN_RUNGS, STATES } = require('./schema')
const store = require('./store')
const { transitionTo } = require('./transitions')

const USAGE = `usage: octowiz state <command> [options]

commands:
  init                    create .octowiz/state.json (+ first ledger event)
  show                    print current state
  validate                validate state file and ledger
  transition <state>      move to one of: ${STATES.join(', ')}
  set-goal <goal>         set the current goal
  link-artifact           --type issue|prd|pr --id <id> [--url <url>] | --waive --reason <r>
  decide <statement>      record an accepted decision [--reason r] [--supersedes id]
  ask <question>          open a question [--non-blocking]
  resolve-question <id>   resolve a question [--answer <a>]
  add-criterion <text>    add an acceptance criterion
  criterion <id>          update: --status pending|passed|failed|waived [--evidence ref] [--reason r]
  lean                    record lean gate: --rung <${LEAN_RUNGS[0]}|...> --decision <d>
                          [--reject alt]... [--ceiling c] [--upgrade-trigger t] [--failed]
  evidence <kind> <status> record evidence: --ref <ref> [--note n] [--reason r]
  next                    deterministic next-action recommendation
                          [--execution advisor|workflow] [--partitionable]
                          [--scope text] [--verification text] [--max-agents N]
                          [--writes --isolation worktree] [--budget-tokens N]
  history                 print ledger events [--limit N]
  repair                  back up an invalid state file and recreate a valid one

global options: --json, --expected-revision <n> (mutations)`

function parse(argv, options = {}) {
  return parseArgs({
    args: argv,
    options: {
      'json': { type: 'boolean', default: false },
      'expected-revision': { type: 'string' },
      ...options,
    },
    allowPositionals: true,
  })
}

function mutationOpts(values) {
  const opts = {}
  if (values['expected-revision'] !== undefined) {
    const revision = Number(values['expected-revision'])
    if (!Number.isInteger(revision) || revision < 1)
      throw new StateError('E_USAGE', '--expected-revision must be a positive integer')
    opts.expectedRevision = revision
  }
  return opts
}

function summarize(doc) {
  const lines = [
    `state:     ${doc.state} (phase ${doc.phase}, ${doc.status}) — revision ${doc.revision}`,
    `repo:      ${doc.repository.id}`,
    `goal:      ${doc.goal ?? '(none)'}`,
    `artifact:  ${doc.artifact ? (doc.artifact.type === 'waived' ? `waived — ${doc.artifact.reason}` : `${doc.artifact.type} ${doc.artifact.id}`) : '(none)'}`,
    `lean gate: ${doc.leanGate.status}${doc.leanGate.selectedRung ? ` (${doc.leanGate.selectedRung})` : ''}`,
    `evidence:  ${['tests', 'lint', 'types', 'review'].map(k => `${k}=${doc.evidence[k].status}`).join(' ')}`,
    `criteria:  ${doc.acceptanceCriteria.length} (${doc.acceptanceCriteria.filter(a => a.status === 'passed').length} passed)`,
    `questions: ${doc.openQuestions.filter(q => q.status === 'open').length} open`,
  ]
  if (doc.state === 'blocked')
    lines.push(`blocked:   returns to ${doc.blockedFrom}`)
  return lines.join('\n')
}

const COMMANDS = {
  'init': (argv, cwd) => {
    const { values } = parse(argv, {
      'force': { type: 'boolean', default: false },
      'repository-id': { type: 'string' },
    })
    const doc = store.init(cwd, { force: values.force, repositoryId: values['repository-id'] })
    return { values, data: doc, human: `initialized engineering state for ${doc.repository.id}\n${summarize(doc)}` }
  },

  'show': (argv, cwd) => {
    const { values } = parse(argv)
    const doc = store.read(cwd)
    return { values, data: doc, human: summarize(doc) }
  },

  'validate': (argv, cwd) => {
    const { values } = parse(argv)
    const doc = store.read(cwd)
    const events = store.history(cwd)
    const result = { valid: true, revision: doc.revision, events: events.length }
    return { values, data: result, human: `state is valid (revision ${doc.revision}, ${events.length} ledger events)` }
  },

  'transition': (argv, cwd) => {
    const { values, positionals } = parse(argv, {
      'waive-activity-check': { type: 'boolean', default: false },
      'reason': { type: 'string' },
    })
    const target = positionals[0]
    if (!target)
      throw new StateError('E_USAGE', `transition requires a target state (one of: ${STATES.join(', ')})`)
    if (values['waive-activity-check'] && !values.reason)
      throw new StateError('E_USAGE', '--waive-activity-check requires --reason')
    const doc = store.mutate(cwd, current => transitionTo(current, target, {
      cwd,
      waiveActivityCheck: values['waive-activity-check'],
      reason: values.reason,
    }), mutationOpts(values))
    return { values, data: doc, human: `transitioned to ${doc.state} (revision ${doc.revision})` }
  },

  'set-goal': (argv, cwd) => {
    const { values, positionals } = parse(argv)
    const doc = store.mutate(cwd, current => operations.setGoal(current, positionals.join(' ')), mutationOpts(values))
    return { values, data: doc, human: `goal set (revision ${doc.revision}): ${doc.goal}` }
  },

  'link-artifact': (argv, cwd) => {
    const { values } = parse(argv, {
      type: { type: 'string' },
      id: { type: 'string' },
      url: { type: 'string' },
      waive: { type: 'boolean', default: false },
      reason: { type: 'string' },
    })
    const doc = store.mutate(cwd, (current) => {
      if (values.waive)
        return operations.waiveArtifact(current, values.reason)
      return operations.linkArtifact(current, { type: values.type, id: values.id, url: values.url ?? null })
    }, mutationOpts(values))
    const human = doc.artifact.type === 'waived'
      ? `artifact waived (revision ${doc.revision}): ${doc.artifact.reason}`
      : `artifact linked (revision ${doc.revision}): ${doc.artifact.type} ${doc.artifact.id}`
    return { values, data: doc, human }
  },

  'decide': (argv, cwd) => {
    const { values, positionals } = parse(argv, {
      reason: { type: 'string' },
      supersedes: { type: 'string' },
    })
    let recorded
    const doc = store.mutate(cwd, (current) => {
      const result = operations.recordDecision(current, {
        statement: positionals.join(' '),
        reason: values.reason ?? null,
        supersedes: values.supersedes ?? null,
      })
      recorded = result.events[0].payload.id
      return result
    }, mutationOpts(values))
    return { values, data: doc, human: `decision ${recorded} recorded (revision ${doc.revision})` }
  },

  'ask': (argv, cwd) => {
    const { values, positionals } = parse(argv, {
      'non-blocking': { type: 'boolean', default: false },
    })
    let id
    const doc = store.mutate(cwd, (current) => {
      const result = operations.openQuestion(current, {
        question: positionals.join(' '),
        blocking: !values['non-blocking'],
      })
      id = result.events[0].payload.id
      return result
    }, mutationOpts(values))
    return { values, data: doc, human: `question ${id} opened (${values['non-blocking'] ? 'non-blocking' : 'blocking'}, revision ${doc.revision})` }
  },

  'resolve-question': (argv, cwd) => {
    const { values, positionals } = parse(argv, { answer: { type: 'string' } })
    const id = positionals[0]
    if (!id)
      throw new StateError('E_USAGE', 'resolve-question requires a question id')
    const doc = store.mutate(cwd, current => operations.resolveQuestion(current, { id, answer: values.answer ?? null }), mutationOpts(values))
    return { values, data: doc, human: `question ${id} resolved (revision ${doc.revision})` }
  },

  'add-criterion': (argv, cwd) => {
    const { values, positionals } = parse(argv)
    let id
    const doc = store.mutate(cwd, (current) => {
      const result = operations.addCriterion(current, { statement: positionals.join(' ') })
      id = result.events[0].payload.id
      return result
    }, mutationOpts(values))
    return { values, data: doc, human: `criterion ${id} added (revision ${doc.revision})` }
  },

  'criterion': (argv, cwd) => {
    const { values, positionals } = parse(argv, {
      status: { type: 'string' },
      evidence: { type: 'string' },
      reason: { type: 'string' },
    })
    const id = positionals[0]
    if (!id || !values.status)
      throw new StateError('E_USAGE', 'criterion requires an id and --status')
    const doc = store.mutate(cwd, current => operations.updateCriterion(current, {
      id,
      status: values.status,
      evidenceRef: values.evidence ?? null,
      waiverReason: values.reason ?? null,
    }), mutationOpts(values))
    return { values, data: doc, human: `criterion ${id} -> ${values.status} (revision ${doc.revision})` }
  },

  'lean': (argv, cwd) => {
    const { values } = parse(argv, {
      'rung': { type: 'string' },
      'decision': { type: 'string' },
      'reject': { type: 'string', multiple: true },
      'ceiling': { type: 'string' },
      'upgrade-trigger': { type: 'string' },
      'failed': { type: 'boolean', default: false },
      'waives': { type: 'string', multiple: true },
    })
    const doc = store.mutate(cwd, current => operations.recordLeanGate(current, {
      status: values.failed ? 'failed' : 'passed',
      selectedRung: values.rung,
      decision: values.decision,
      rejectedAlternatives: values.reject ?? [],
      knownCeiling: values.ceiling ?? null,
      upgradeTrigger: values['upgrade-trigger'] ?? null,
      waives: values.waives ?? [],
    }), mutationOpts(values))
    return { values, data: doc, human: `lean gate ${doc.leanGate.status}${doc.leanGate.selectedRung ? ` at rung ${doc.leanGate.selectedRung}` : ''} (revision ${doc.revision})` }
  },

  'evidence': (argv, cwd) => {
    const { values, positionals } = parse(argv, {
      ref: { type: 'string' },
      note: { type: 'string' },
      reason: { type: 'string' },
    })
    const [kind, status] = positionals
    if (!kind || !status)
      throw new StateError('E_USAGE', 'evidence requires <kind> <status> --ref <reference>')
    const doc = store.mutate(cwd, current => operations.recordEvidence(current, {
      kind,
      status,
      ref: values.ref,
      note: values.note ?? null,
      waiverReason: values.reason ?? null,
    }), mutationOpts(values))
    return { values, data: doc, human: `${kind} evidence recorded as ${status} (revision ${doc.revision})` }
  },

  'next': (argv, cwd) => {
    const { values } = parse(argv, {
      'execution': { type: 'string' },
      'partitionable': { type: 'boolean', default: false },
      'scope': { type: 'string' },
      'verification': { type: 'string' },
      'max-agents': { type: 'string' },
      'writes': { type: 'boolean', default: false },
      'isolation': { type: 'string' },
      'budget-tokens': { type: 'string' },
    })
    const doc = store.read(cwd)
    let registry = null
    try {
      const path = require('node:path')
      const { loadRegistryWithOverrides } = require('../capabilities/registry')
      const overridesPath = path.resolve(cwd, '.octowiz', 'capabilities.json')
      registry = loadRegistryWithOverrides({ overridesPath })
    }
    catch (error) {
      throw new StateError('E_REGISTRY', `capability registry could not be loaded: ${error.message}`)
    }
    const { getExecutionDefaults } = require('../runtimes/selection')
    let executionRequest
    if (values.execution && !['advisor', 'workflow'].includes(values.execution))
      throw new StateError('E_USAGE', '--execution must be advisor or workflow')
    if (values.execution === 'advisor') {
      executionRequest = { pattern: 'advisor' }
    }
    else if (values.execution === 'workflow') {
      executionRequest = {
        pattern: 'workflow',
        partitionable: values.partitionable,
        writes: values.writes,
      }
      if (values.scope !== undefined)
        executionRequest.scope = values.scope
      if (values.verification !== undefined)
        executionRequest.verification = values.verification
      if (values['max-agents'] !== undefined)
        executionRequest.maxAgents = Number(values['max-agents'])
      if (values.isolation !== undefined)
        executionRequest.isolation = values.isolation
      if (values['budget-tokens'] !== undefined)
        executionRequest.budgetTokens = Number(values['budget-tokens'])
    }
    const next = resolveNextAction(doc, {
      cwd,
      registry,
      executionRequest,
      executionDefaults: getExecutionDefaults(cwd),
    })
    const human = next.capability
      ? `next: ${next.capability}${next.humanGate ? ' (human gate)' : ''}${next.resolved ? `\nresolved: ${next.resolved.provider}:${next.resolved.command}` : ''}\nexecution: ${next.execution.pattern} — ${next.execution.reason}\nreason: ${next.reason}`
      : `no next action — ${next.reason}`
    return { values, data: next, human }
  },

  'history': (argv, cwd) => {
    const { values } = parse(argv, { limit: { type: 'string' } })
    const limit = values.limit !== undefined ? Number(values.limit) : 20
    if (!Number.isInteger(limit) || limit < 1)
      throw new StateError('E_USAGE', '--limit must be a positive integer')
    const events = store.history(cwd, { limit })
    const human = events.length === 0
      ? 'no ledger events'
      : events.map(e => `r${e.revision}  ${e.timestamp}  ${e.type}${e.payload?.to ? `  -> ${e.payload.to}` : ''}`).join('\n')
    return { values, data: events, human }
  },

  'repair': (argv, cwd) => {
    const { values } = parse(argv)
    const { doc, backupFile } = store.repair(cwd)
    const human = backupFile
      ? `state repaired at revision ${doc.revision}; the broken file was preserved at ${backupFile}`
      : `state is already valid (revision ${doc.revision}); nothing repaired`
    return { values, data: { repaired: Boolean(backupFile), revision: doc.revision, backupFile }, human }
  },
}

/**
 * Runs one `octowiz state ...` invocation without exiting the process.
 * @param {string[]} argv arguments after "state"
 * @param {object} [io]
 * @param {string} [io.cwd]
 * @param {(line: string) => void} [io.stdout]
 * @param {(line: string) => void} [io.stderr]
 * @returns {number} exit code
 */
function runState(argv, { cwd = process.cwd(), stdout = console.log, stderr = console.error } = {}) {
  const [command, ...rest] = argv

  if (!command || command === 'help' || command === '--help') {
    stdout(USAGE)
    return command ? 0 : 1
  }

  const handler = COMMANDS[command]
  if (!handler) {
    stderr(`unknown state command: ${command}\n\n${USAGE}`)
    return 1
  }

  const strayRuntimeFile = runtimeFileInsideRepo(cwd)
  if (strayRuntimeFile)
    stderr(`warning: machine-local runtime state found inside the repository at ${strayRuntimeFile} — it belongs under the user cache directory and must not be committed`)

  try {
    const { values, data, human } = handler(rest, cwd)
    stdout(values.json ? JSON.stringify(data, null, 2) : human)
    return 0
  }
  catch (error) {
    const wantsJson = argv.includes('--json')
    if (error instanceof StateError) {
      stderr(wantsJson
        ? JSON.stringify({ error: { code: error.code, message: error.message, details: error.details } }, null, 2)
        : `error (${error.code}): ${error.message}${error.details?.failures ? `\n  - ${error.details.failures.join('\n  - ')}` : ''}${error.details?.issues ? `\n  - ${error.details.issues.join('\n  - ')}` : ''}`)
      return 1
    }
    stderr(wantsJson
      ? JSON.stringify({ error: { code: 'E_UNEXPECTED', message: error.message } }, null, 2)
      : `unexpected error: ${error.message}`)
    return 1
  }
}

module.exports = { runState, USAGE }
