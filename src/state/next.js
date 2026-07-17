'use strict'

// Deterministic next-action resolver. Pure precedence rules over the state
// document plus observed repository facts — no LLM, no randomness. Capability
// names prepare for later capability routing without introducing a registry.

const { REQUIRED_CHECK_KINDS, hasWorkingTreeChanges } = require('./transitions')

function evidenceSatisfied(group) {
  return group && (group.status === 'passed' || group.status === 'not-configured' || group.status === 'waived')
}

/**
 * Attempt to resolve a capability name through the registry. Returns null
 * when no registry is in context or no resolver qualifies.
 * @param {string|null} capabilityName
 * @param {object} context
 * @returns {{ provider: string, command: string }|null}
 */
function tryResolve(capabilityName, context) {
  if (!capabilityName || !context.registry)
    return null
  const { resolveWithConditions } = require('../capabilities/registry')
  const resolved = resolveWithConditions(context.registry, capabilityName, context.cwd || process.cwd())
  if (!resolved)
    return null
  return { provider: resolved.provider, command: resolved.command }
}

/**
 * @param {object} doc valid state document
 * @param {object} [context]
 * @param {string} [context.cwd] repository root, enables observed checks
 * @param {object} [context.registry] validated capability registry document
 * @returns {{ capability: string | null, reason: string, humanGate: boolean, resolved?: { provider: string, command: string } }} the recommendation
 */
function resolveNextAction(doc, context = {}) {
  const result = computeNextAction(doc, context)
  const resolved = tryResolve(result.capability, context)
  const { resolveExecutionPolicy } = require('../execution/policy')
  const execution = resolveExecutionPolicy(context.executionRequest, context.executionDefaults)
  if (resolved)
    return { ...result, resolved, execution }
  return { ...result, execution }
}

function computeNextAction(doc, context) {
  if (doc.state === 'blocked') {
    return {
      capability: 'human-decision',
      reason: `work is blocked and can only return to ${doc.blockedFrom}; a human decision is needed to unblock`,
      humanGate: true,
    }
  }

  if (doc.state === 'shipped')
    return { capability: null, reason: 'work is shipped; initialize a new goal to continue', humanGate: false }

  if (!doc.goal)
    return { capability: 'requirements-discovery', reason: 'no goal is set', humanGate: false }

  const blocking = doc.openQuestions.filter(q => q.status === 'open' && q.blocking)
  if (blocking.length > 0) {
    return {
      capability: 'decision-resolution',
      reason: `unresolved blocking questions: ${blocking.map(q => q.id).join(', ')}`,
      humanGate: false,
    }
  }

  if (doc.acceptanceCriteria.length > 0 && doc.leanGate.status === 'pending')
    return { capability: 'lean-design-check', reason: 'goal and criteria exist but the lean gate has not been decided', humanGate: false }

  switch (doc.state) {
    case 'explore':
      return { capability: 'definition', reason: 'a goal exists; define scope and acceptance criteria', humanGate: false }
    case 'define':
      return { capability: 'plan-validation', reason: 'definition exists; validate the plan before implementation', humanGate: false }
    case 'plan':
      return { capability: 'implementation', reason: 'plan is in place; begin implementation', humanGate: false }
    case 'diagnose':
      return { capability: 'diagnosis', reason: 'a diagnosis is in progress; resolve the root cause before implementing further', humanGate: false }
    case 'implement': {
      if (doc.evidence.tests.status === 'failed')
        return { capability: 'diagnosis', reason: 'tests are failing', humanGate: false }
      if (context.cwd && hasWorkingTreeChanges(context.cwd))
        return { capability: 'verification', reason: 'implementation has changed files and no current verification evidence', humanGate: false }
      return { capability: 'implementation', reason: 'implementation is active with no changed files observed', humanGate: false }
    }
    case 'verify': {
      const unsatisfied = REQUIRED_CHECK_KINDS.filter(kind => !evidenceSatisfied(doc.evidence[kind]))
      if (unsatisfied.length === 0)
        return { capability: 'code-review', reason: 'required automated evidence is satisfied', humanGate: false }
      return { capability: 'verification', reason: `evidence still required: ${unsatisfied.join(', ')}`, humanGate: false }
    }
    case 'review': {
      if (evidenceSatisfied(doc.evidence.review) && doc.evidence.review.status !== 'not-configured')
        return { capability: 'handoff-or-ship', reason: 'review passed with no blocking findings', humanGate: true }
      return { capability: 'code-review', reason: 'review evidence is not yet recorded as passed', humanGate: false }
    }
    case 'ready-to-ship':
      return { capability: 'handoff-or-ship', reason: 'work is ready to ship; merge or release is a human decision', humanGate: true }
    default:
      return { capability: null, reason: `no deterministic recommendation for state ${doc.state}`, humanGate: false }
  }
}

module.exports = { resolveNextAction }
