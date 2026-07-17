'use strict'

// Explicit, validated state machine over the internal workflow states. No
// generic workflow engine: the transition table and the guards below are the
// entire policy, and an invalid transition fails without touching the
// document.

const { execFileSync } = require('node:child_process')

const { GuardError, TransitionError } = require('./errors')
const { ACTIVE_STATES, STATE_TO_PHASE } = require('./schema')

const TRANSITIONS = {
  'explore': ['define'],
  'define': ['plan'],
  'plan': ['slice', 'implement'],
  'slice': ['implement'],
  'implement': ['verify', 'diagnose'],
  'diagnose': ['implement'],
  'verify': ['implement', 'review'],
  'review': ['implement', 'ready-to-ship'],
  'ready-to-ship': ['shipped'],
  'shipped': [],
  // blocked is reachable from any active state and returns to blockedFrom;
  // handled explicitly in transitionTo, not via this table.
  'blocked': [],
}

// Evidence kinds that gate verify -> review. `not-configured` means the
// repository genuinely has no such check and is not treated as missing.
const REQUIRED_CHECK_KINDS = ['tests', 'lint', 'types']

function hasWorkingTreeChanges(cwd) {
  try {
    const out = execFileSync('git', ['-C', cwd, 'status', '--porcelain'], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    // Octowiz's own state files are bookkeeping, not implementation activity.
    return out.split('\n').some((line) => {
      const p = line.slice(3)
      return line.trim().length > 0 && !p.startsWith('.octowiz/') && p !== '.octowiz'
    })
  }
  catch {
    return false
  }
}

function blockingOpenQuestions(doc) {
  return doc.openQuestions.filter(q => q.status === 'open' && q.blocking)
}

function evidenceGroupSatisfied(group) {
  if (!group)
    return false
  if (group.status === 'not-configured' || group.status === 'passed')
    return true
  if (group.status === 'waived')
    return group.items.some(item => item.status === 'waived' && item.waiverReason)
  return false
}

// Every guard returns a list of human-readable failures (empty = pass).
// `context.cwd` lets the implement -> verify guard observe the repository;
// `context.waiveActivityCheck` is the explicit escape hatch for fully
// committed work, and requires a reason at the CLI layer.
function implementationReadinessGuard(doc) {
  const failures = []
  if (!doc.goal)
    failures.push('a goal must be set (octowiz state set-goal)')
  if (!doc.artifact)
    failures.push('a primary artifact must be linked or explicitly waived (octowiz state link-artifact)')
  if (doc.acceptanceCriteria.length === 0)
    failures.push('at least one acceptance criterion is required (octowiz state add-criterion)')
  const blocking = blockingOpenQuestions(doc)
  if (blocking.length > 0)
    failures.push(`unresolved blocking questions: ${blocking.map(q => q.id).join(', ')}`)
  return failures
}

const GUARDS = {
  // Ticket breakdown (mattpocock-skills: to-tickets) is an optional slicing
  // step for multi-session work; both the direct plan -> implement path and
  // the plan -> slice -> implement path require the same readiness facts.
  'plan->implement': implementationReadinessGuard,
  'slice->implement': implementationReadinessGuard,

  'implement->verify': (doc, context) => {
    if (context.waiveActivityCheck)
      return []
    if (context.cwd && hasWorkingTreeChanges(context.cwd))
      return []
    return ['no implementation activity detected (no working-tree changes) — commit-only work can pass --waive-activity-check with a reason']
  },

  'verify->review': (doc) => {
    const failures = []
    for (const kind of REQUIRED_CHECK_KINDS) {
      const group = doc.evidence[kind]
      if (!evidenceGroupSatisfied(group))
        failures.push(`${kind} evidence must be passed or explicitly waived with a reason (currently ${group ? group.status : 'missing'})`)
    }
    return failures
  },

  'review->ready-to-ship': (doc) => {
    const failures = []
    if (!evidenceGroupSatisfied(doc.evidence.review))
      failures.push(`review evidence must be passed or waived with a reason (currently ${doc.evidence.review.status})`)
    const unresolved = doc.acceptanceCriteria.filter(a => a.status !== 'passed' && a.status !== 'waived')
    if (unresolved.length > 0)
      failures.push(`acceptance criteria not passed or waived: ${unresolved.map(a => a.id).join(', ')}`)
    return failures
  },

  'ready-to-ship->shipped': (doc) => {
    const ship = doc.evidence.ship
    if (ship && ship.status === 'passed' && ship.items.length > 0)
      return []
    return ['shipping requires completion evidence (octowiz state evidence ship passed --ref <merge/release reference>)']
  },
}

/**
 * Validates and applies one transition, returning the changed document and
 * the ledger event descriptor. Throws TransitionError for an illegal edge and
 * GuardError when preconditions fail; the input document is not modified.
 * @param {object} doc current state document (already a mutable copy)
 * @param {string} to target state
 * @param {object} [context]
 * @param {string} [context.cwd] repository root for observed guards
 * @param {boolean} [context.waiveActivityCheck]
 * @param {string} [context.reason] reason for blocked / waivers
 * @returns {{ doc: object, events: Array<{ type: string, payload: object }> }} changed document and ledger event descriptors
 */
function transitionTo(doc, to, context = {}) {
  const from = doc.state

  if (from === to)
    throw new TransitionError(`state is already ${JSON.stringify(to)}`, { from, to })

  if (to === 'blocked') {
    if (!ACTIVE_STATES.includes(from))
      throw new TransitionError(`cannot block from ${JSON.stringify(from)}`, { from, to })
    doc.blockedFrom = from
    doc.state = 'blocked'
    doc.status = 'blocked'
    doc.phase = STATE_TO_PHASE.blocked
    return { doc, events: [{ type: 'state.transitioned', payload: { from, to, reason: context.reason ?? null } }] }
  }

  if (from === 'blocked') {
    if (to !== doc.blockedFrom) {
      throw new TransitionError(
        `blocked state can only return to its previous active state ${JSON.stringify(doc.blockedFrom)}`,
        { from, to, blockedFrom: doc.blockedFrom },
      )
    }
    doc.state = to
    doc.status = 'active'
    doc.blockedFrom = null
    doc.phase = STATE_TO_PHASE[to]
    return { doc, events: [{ type: 'state.transitioned', payload: { from, to, reason: context.reason ?? null } }] }
  }

  const allowed = TRANSITIONS[from] ?? []
  if (!allowed.includes(to)) {
    throw new TransitionError(
      `invalid transition ${from} -> ${to} (allowed from ${from}: ${allowed.length ? allowed.join(', ') : 'none'}, blocked)`,
      { from, to, allowed },
    )
  }

  const guard = GUARDS[`${from}->${to}`]
  if (guard) {
    const failures = guard(doc, context)
    if (failures.length > 0) {
      throw new GuardError(
        `transition ${from} -> ${to} blocked by ${failures.length} unmet precondition${failures.length === 1 ? '' : 's'}: ${failures.join('; ')}`,
        { from, to, failures },
      )
    }
  }

  doc.state = to
  doc.status = to === 'shipped' ? 'done' : 'active'
  doc.phase = STATE_TO_PHASE[to]
  return {
    doc,
    events: [{
      type: 'state.transitioned',
      payload: {
        from,
        to,
        ...(context.waiveActivityCheck ? { waivedActivityCheck: true, reason: context.reason ?? null } : {}),
      },
    }],
  }
}

module.exports = { TRANSITIONS, GUARDS, REQUIRED_CHECK_KINDS, transitionTo, hasWorkingTreeChanges }
