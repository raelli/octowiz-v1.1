'use strict'

// Mutation builders: each takes the (already copied) document plus input,
// changes it in place, and returns { doc, events } for store.mutate(). All
// user-supplied text passes schema validation afterwards, which enforces the
// portability rules; specific input rules (waiver reasons, protected
// concerns) live here so failures name the actual mistake.

const crypto = require('node:crypto')

const { ValidationError } = require('./errors')
const {
  ARTIFACT_TYPES,
  COMPLEXITY_REVIEW_STATUSES,
  CRITERION_STATUSES,
  EVIDENCE_KINDS,
  EVIDENCE_STATUSES,
  LEAN_RUNGS,
  PROTECTED_CONCERNS,
} = require('./schema')

function newId(prefix) {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`
}

function requireText(value, label) {
  if (typeof value !== 'string' || !value.trim())
    throw new ValidationError(`${label} must be a non-empty string`)
  return value.trim()
}

function setGoal(doc, goal) {
  doc.goal = requireText(goal, 'goal')
  return { doc, events: [{ type: 'goal.updated', payload: { goal: doc.goal } }] }
}

function linkArtifact(doc, { type, id, url = null }) {
  if (!ARTIFACT_TYPES.includes(type) || type === 'waived')
    throw new ValidationError(`artifact type must be one of ${ARTIFACT_TYPES.filter(t => t !== 'waived').join(', ')}`)
  doc.artifact = { type, id: requireText(id, 'artifact id'), url }
  return { doc, events: [{ type: 'artifact.linked', payload: { type, id: doc.artifact.id, url } }] }
}

function waiveArtifact(doc, reason) {
  doc.artifact = { type: 'waived', id: null, url: null, reason: requireText(reason, 'artifact waiver reason') }
  return { doc, events: [{ type: 'artifact.linked', payload: { type: 'waived', reason: doc.artifact.reason } }] }
}

// Accepted decisions are immutable; recording a decision with `supersedes`
// marks the older one superseded instead of editing it.
function recordDecision(doc, { statement, reason = null, supersedes = null, id = newId('decision') }) {
  const decision = {
    id,
    statement: requireText(statement, 'decision statement'),
    reason,
    status: 'accepted',
    recordedAt: doc.updatedAt,
  }
  if (supersedes) {
    const old = doc.decisions.find(d => d.id === supersedes)
    if (!old)
      throw new ValidationError(`decision ${JSON.stringify(supersedes)} not found`)
    old.status = 'superseded'
    old.supersededBy = decision.id
  }
  doc.decisions.push(decision)
  return { doc, events: [{ type: 'decision.recorded', payload: { id: decision.id, statement: decision.statement, supersedes } }] }
}

function openQuestion(doc, { question, blocking = true, id = newId('q') }) {
  doc.openQuestions.push({
    id,
    question: requireText(question, 'question'),
    blocking,
    status: 'open',
    answer: null,
    openedAt: doc.updatedAt,
    resolvedAt: null,
  })
  return { doc, events: [{ type: 'question.opened', payload: { id, blocking } }] }
}

function resolveQuestion(doc, { id, answer = null }) {
  const q = doc.openQuestions.find(item => item.id === id)
  if (!q)
    throw new ValidationError(`question ${JSON.stringify(id)} not found`)
  if (q.status === 'resolved')
    throw new ValidationError(`question ${JSON.stringify(id)} is already resolved`)
  q.status = 'resolved'
  q.answer = answer
  q.resolvedAt = doc.updatedAt
  return { doc, events: [{ type: 'question.resolved', payload: { id } }] }
}

function addCriterion(doc, { statement, id = newId('ac') }) {
  doc.acceptanceCriteria.push({
    id,
    statement: requireText(statement, 'criterion statement'),
    status: 'pending',
    evidenceRefs: [],
    waiverReason: null,
    updatedAt: doc.updatedAt,
  })
  return { doc, events: [{ type: 'criterion.added', payload: { id } }] }
}

function updateCriterion(doc, { id, status, evidenceRef = null, waiverReason = null }) {
  const criterion = doc.acceptanceCriteria.find(a => a.id === id)
  if (!criterion)
    throw new ValidationError(`criterion ${JSON.stringify(id)} not found`)
  if (!CRITERION_STATUSES.includes(status))
    throw new ValidationError(`criterion status must be one of ${CRITERION_STATUSES.join(', ')}`)
  if (evidenceRef)
    criterion.evidenceRefs.push(evidenceRef)
  if (status === 'passed' && criterion.evidenceRefs.length === 0)
    throw new ValidationError('a criterion can only pass with at least one evidence reference (--evidence <ref>)')
  if (status === 'waived') {
    criterion.waiverReason = requireText(waiverReason, 'criterion waiver reason (--reason)')
  }
  criterion.status = status
  criterion.updatedAt = doc.updatedAt
  return { doc, events: [{ type: 'criterion.updated', payload: { id, status } }] }
}

/**
 * Records the lean engineering gate decision: which ladder rung satisfied the
 * requirement, what was rejected, and when the decision must be revisited.
 * The gate can never waive a protected concern — that is a structural rule,
 * not a judgment call.
 */
function recordLeanGate(doc, { status, selectedRung, decision, rejectedAlternatives = [], knownCeiling = null, upgradeTrigger = null, waives = [] }) {
  if (!['passed', 'failed'].includes(status))
    throw new ValidationError('lean gate status must be passed or failed')
  if (status === 'passed' && !LEAN_RUNGS.includes(selectedRung))
    throw new ValidationError(`selected rung must be one of ${LEAN_RUNGS.join(', ')}`)
  const protectedHits = waives.filter(w => PROTECTED_CONCERNS.includes(w))
  if (protectedHits.length > 0) {
    throw new ValidationError(
      `the lean gate cannot waive protected concerns: ${protectedHits.join(', ')}`,
      { protectedConcerns: protectedHits },
    )
  }
  doc.leanGate = {
    status,
    selectedRung: status === 'passed' ? selectedRung : null,
    decision: status === 'passed' ? requireText(decision, 'lean gate decision') : decision ?? null,
    rejectedAlternatives,
    knownCeiling,
    upgradeTrigger,
    recordedAt: doc.updatedAt,
  }
  return { doc, events: [{ type: 'lean-gate.recorded', payload: { status, selectedRung: doc.leanGate.selectedRung } }] }
}

// Records the phase-D complexity-reduction pass outcome. Findings use the
// lean-engineering review format (`<file>:L<range> <category>: ...`); an
// empty list with status `passed` means "lean already".
function recordComplexityReview(doc, { status, findings = [], estimatedLinesRemovable = null }) {
  if (!COMPLEXITY_REVIEW_STATUSES.includes(status) || status === 'pending')
    throw new ValidationError(`complexity review status must be one of ${COMPLEXITY_REVIEW_STATUSES.filter(s => s !== 'pending').join(', ')}`)
  if (estimatedLinesRemovable !== null && !Number.isInteger(estimatedLinesRemovable))
    throw new ValidationError('estimated removable lines (--lines) must be an integer')
  doc.complexityReview = {
    status,
    findings: findings.map((f, i) => requireText(f, `complexity finding [${i}]`)),
    estimatedLinesRemovable,
  }
  return { doc, events: [{ type: 'complexity-review.recorded', payload: { status, findings: doc.complexityReview.findings.length } }] }
}

function recordEvidence(doc, { kind, status, ref, note = null, waiverReason = null }) {
  if (!EVIDENCE_KINDS.includes(kind))
    throw new ValidationError(`evidence kind must be one of ${EVIDENCE_KINDS.join(', ')}`)
  if (!EVIDENCE_STATUSES.includes(status) || status === 'not-configured')
    throw new ValidationError(`evidence status must be one of ${EVIDENCE_STATUSES.filter(s => s !== 'not-configured').join(', ')}`)
  const item = {
    id: newId('evidence'),
    status,
    ref: requireText(ref, 'evidence ref (--ref)'),
    note,
    recordedAt: doc.updatedAt,
  }
  if (status === 'waived')
    item.waiverReason = requireText(waiverReason, 'evidence waiver reason (--reason)')
  if (!doc.evidence[kind])
    doc.evidence[kind] = { status: 'pending', items: [] }
  doc.evidence[kind].items.push(item)
  doc.evidence[kind].status = status
  const eventType = kind === 'review' ? 'review.recorded' : 'evidence.recorded'
  return { doc, events: [{ type: eventType, payload: { kind, status, ref: item.ref, evidenceId: item.id } }] }
}

module.exports = {
  setGoal,
  linkArtifact,
  waiveArtifact,
  recordDecision,
  openQuestion,
  resolveQuestion,
  addCriterion,
  updateCriterion,
  recordLeanGate,
  recordComplexityReview,
  recordEvidence,
}
