'use strict'

// Canonical shape and validation of `.octowiz/state.json` — the durable,
// machine-independent engineering truth for a repository. Everything here may
// be committed and shared; nothing here may describe a single machine.
//
// Validation is hand-rolled on purpose (lean gate: standard-library rung).
// The document is small, the rules are specific (portability, enum, shape),
// and a JSON Schema engine would be a dependency without a payoff yet.

const { ValidationError } = require('./errors')

const SCHEMA_VERSION = '0.1'

const PHASES = ['A', 'B', 'C', 'D']

const STATES = [
  'explore',
  'define',
  'plan',
  'slice',
  'implement',
  'diagnose',
  'verify',
  'review',
  'blocked',
  'ready-to-ship',
  'shipped',
]

// States a work item can be "in the middle of" — blocked remembers one of
// these in `blockedFrom` so it can return there.
const ACTIVE_STATES = STATES.filter(s => s !== 'blocked' && s !== 'shipped')

// Human-facing phase for each internal state. A/B/C/D stays the vocabulary
// people use; the internal state is what guards operate on.
const STATE_TO_PHASE = {
  'explore': 'A',
  'define': 'A',
  'plan': 'B',
  'slice': 'B',
  'implement': 'C',
  'diagnose': 'C',
  'blocked': 'C',
  'verify': 'D',
  'review': 'D',
  'ready-to-ship': 'D',
  'shipped': 'D',
}

const STATUSES = ['active', 'blocked', 'done']

const ARTIFACT_TYPES = ['issue', 'prd', 'pr', 'waived']

const DECISION_STATUSES = ['accepted', 'superseded']

const QUESTION_STATUSES = ['open', 'resolved']

const CRITERION_STATUSES = ['pending', 'passed', 'failed', 'waived']

const EVIDENCE_KINDS = ['tests', 'lint', 'types', 'review', 'ship']

const EVIDENCE_STATUSES = ['pending', 'passed', 'failed', 'waived', 'not-configured']

const LEAN_GATE_STATUSES = ['pending', 'passed', 'failed']

const LEAN_RUNGS = [
  'do-nothing',
  'reuse-existing-code',
  'standard-library',
  'native-platform',
  'installed-dependency',
  'shrink-design',
  'minimal-new-code',
]

// Concerns the lean gate may never waive on its own; simplification stops at
// these boundaries regardless of the selected rung.
const PROTECTED_CONCERNS = [
  'trust-boundary-validation',
  'data-loss-prevention',
  'authentication',
  'authorization',
  'accessibility',
  'required-compatibility',
  'accepted-product-requirements',
  'repository-test-expectations',
]

const COMPLEXITY_REVIEW_STATUSES = ['pending', 'passed', 'waived']

// ------------------------------------------------------------ portability --

// Patterns that must never appear in durable state or ledger events: local
// absolute paths tie the file to one machine; token-shaped strings are
// probably credentials pasted by accident.
const LOCAL_PATH_PATTERN = /(?:^|[\s"'`=:])(?:\/(?:Users|home|root|private\/var|var\/folders)\/|[A-Z]:\\Users\\|~\/)/
const SECRET_PATTERN = /\b(?:sk-[\w-]{16,}|ghp_\w{16,}|gho_\w{16,}|github_pat_\w{16,}|xox[baprs]-[\w-]{10,}|eyJ[\w-]{20,}\.[\w-]{20,}\.[\w-]+|AKIA[A-Z0-9]{16}|Bearer\s+[\w.~+/-]{16,})/

/**
 * Returns a human-readable reason when a user-supplied string is not safe to
 * persist in shared state, or null when it is.
 * @param {string} value
 * @returns {string | null} the violation, or null when safe
 */
function portabilityViolation(value) {
  if (typeof value !== 'string')
    return null
  if (SECRET_PATTERN.test(value))
    return 'looks like a credential or token'
  if (LOCAL_PATH_PATTERN.test(value))
    return 'contains a machine-local absolute path'
  return null
}

// ------------------------------------------------------------- validation --

function isIsoTimestamp(value) {
  if (typeof value !== 'string')
    return false
  const t = Date.parse(value)
  return Number.isFinite(t) && /^\d{4}-\d{2}-\d{2}T/.test(value)
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

class Checker {
  constructor() {
    this.issues = []
  }

  fail(path, message) {
    this.issues.push(`${path}: ${message}`)
  }

  keys(path, value, allowed) {
    for (const key of Object.keys(value)) {
      if (!allowed.includes(key))
        this.fail(`${path}.${key}`, 'unknown field')
    }
  }

  object(path, value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      this.fail(path, 'must be an object')
      return false
    }
    return true
  }

  array(path, value) {
    if (!Array.isArray(value)) {
      this.fail(path, 'must be an array')
      return false
    }
    return true
  }

  enumOf(path, value, allowed) {
    if (!allowed.includes(value))
      this.fail(path, `must be one of ${allowed.join(', ')} (got ${JSON.stringify(value)})`)
  }

  string(path, value, { required = true, portable = true } = {}) {
    if (value === null || value === undefined) {
      if (required)
        this.fail(path, 'is required')
      return
    }
    if (typeof value !== 'string') {
      this.fail(path, 'must be a string')
      return
    }
    if (required && !value.trim())
      this.fail(path, 'must not be empty')
    if (portable) {
      const violation = portabilityViolation(value)
      if (violation)
        this.fail(path, violation)
    }
  }

  timestamp(path, value, { required = true } = {}) {
    if (value === null || value === undefined) {
      if (required)
        this.fail(path, 'is required')
      return
    }
    if (!isIsoTimestamp(value))
      this.fail(path, 'must be an ISO-8601 timestamp')
  }

  boolean(path, value) {
    if (typeof value !== 'boolean')
      this.fail(path, 'must be a boolean')
  }
}

function checkEvidenceItem(c, path, item) {
  if (!c.object(path, item))
    return
  c.keys(path, item, ['id', 'status', 'ref', 'note', 'waiverReason', 'recordedAt'])
  c.string(`${path}.id`, item.id)
  c.enumOf(`${path}.status`, item.status, EVIDENCE_STATUSES)
  c.string(`${path}.ref`, item.ref)
  c.string(`${path}.note`, item.note, { required: false })
  c.string(`${path}.waiverReason`, item.waiverReason, { required: false })
  c.timestamp(`${path}.recordedAt`, item.recordedAt)
  if (item.status === 'waived' && !isNonEmptyString(item.waiverReason))
    c.fail(`${path}.waiverReason`, 'is required when status is waived')
}

function checkEvidenceGroup(c, path, group) {
  if (!c.object(path, group))
    return
  c.keys(path, group, ['status', 'items'])
  c.enumOf(`${path}.status`, group.status, EVIDENCE_STATUSES)
  if (c.array(`${path}.items`, group.items))
    group.items.forEach((item, i) => checkEvidenceItem(c, `${path}.items[${i}]`, item))
}

/**
 * Validates a full state document. Throws ValidationError listing every
 * problem found; returns the document unchanged when valid.
 * @param {object} doc
 * @returns {object} the document, unchanged
 */
function validateState(doc) {
  const c = new Checker()

  if (typeof doc !== 'object' || doc === null || Array.isArray(doc))
    throw new ValidationError('state document must be a JSON object', { issues: ['$: must be an object'] })

  if (doc.schemaVersion !== SCHEMA_VERSION) {
    // Version mismatch is terminal — field-level checks below assume 0.1.
    throw new ValidationError(
      `unsupported schemaVersion ${JSON.stringify(doc.schemaVersion)} (this build supports ${SCHEMA_VERSION})`,
      { issues: [`$.schemaVersion: unsupported version ${JSON.stringify(doc.schemaVersion)}`], schemaVersion: doc.schemaVersion },
    )
  }

  c.keys('$', doc, [
    'schemaVersion',
    'repository',
    'phase',
    'state',
    'status',
    'blockedFrom',
    'goal',
    'artifact',
    'decisions',
    'openQuestions',
    'acceptanceCriteria',
    'leanGate',
    'evidence',
    'complexityReview',
    'nextAction',
    'revision',
    'createdAt',
    'updatedAt',
  ])

  if (c.object('$.repository', doc.repository)) {
    c.keys('$.repository', doc.repository, ['id'])
    c.string('$.repository.id', doc.repository.id)
  }

  c.enumOf('$.phase', doc.phase, PHASES)
  c.enumOf('$.state', doc.state, STATES)
  c.enumOf('$.status', doc.status, STATUSES)

  if (doc.blockedFrom !== null && doc.blockedFrom !== undefined)
    c.enumOf('$.blockedFrom', doc.blockedFrom, ACTIVE_STATES)
  if (doc.state === 'blocked' && !ACTIVE_STATES.includes(doc.blockedFrom))
    c.fail('$.blockedFrom', 'must name the previous active state while blocked')

  c.string('$.goal', doc.goal, { required: false })

  if (doc.artifact !== null && doc.artifact !== undefined) {
    if (c.object('$.artifact', doc.artifact)) {
      c.keys('$.artifact', doc.artifact, ['type', 'id', 'url', 'reason'])
      c.enumOf('$.artifact.type', doc.artifact.type, ARTIFACT_TYPES)
      if (doc.artifact.type === 'waived') {
        c.string('$.artifact.reason', doc.artifact.reason)
      }
      else {
        c.string('$.artifact.id', doc.artifact.id)
      }
      c.string('$.artifact.url', doc.artifact.url, { required: false })
    }
  }

  if (c.array('$.decisions', doc.decisions)) {
    doc.decisions.forEach((d, i) => {
      const path = `$.decisions[${i}]`
      if (!c.object(path, d))
        return
      c.keys(path, d, ['id', 'statement', 'reason', 'status', 'supersededBy', 'recordedAt'])
      c.string(`${path}.id`, d.id)
      c.string(`${path}.statement`, d.statement)
      c.string(`${path}.reason`, d.reason, { required: false })
      c.enumOf(`${path}.status`, d.status, DECISION_STATUSES)
      c.string(`${path}.supersededBy`, d.supersededBy, { required: false })
      c.timestamp(`${path}.recordedAt`, d.recordedAt)
    })
  }

  if (c.array('$.openQuestions', doc.openQuestions)) {
    doc.openQuestions.forEach((q, i) => {
      const path = `$.openQuestions[${i}]`
      if (!c.object(path, q))
        return
      c.keys(path, q, ['id', 'question', 'blocking', 'status', 'answer', 'openedAt', 'resolvedAt'])
      c.string(`${path}.id`, q.id)
      c.string(`${path}.question`, q.question)
      c.boolean(`${path}.blocking`, q.blocking)
      c.enumOf(`${path}.status`, q.status, QUESTION_STATUSES)
      c.string(`${path}.answer`, q.answer, { required: false })
      c.timestamp(`${path}.openedAt`, q.openedAt)
      c.timestamp(`${path}.resolvedAt`, q.resolvedAt, { required: false })
    })
  }

  if (c.array('$.acceptanceCriteria', doc.acceptanceCriteria)) {
    doc.acceptanceCriteria.forEach((a, i) => {
      const path = `$.acceptanceCriteria[${i}]`
      if (!c.object(path, a))
        return
      c.keys(path, a, ['id', 'statement', 'status', 'evidenceRefs', 'waiverReason', 'updatedAt'])
      c.string(`${path}.id`, a.id)
      c.string(`${path}.statement`, a.statement)
      c.enumOf(`${path}.status`, a.status, CRITERION_STATUSES)
      if (c.array(`${path}.evidenceRefs`, a.evidenceRefs))
        a.evidenceRefs.forEach((ref, j) => c.string(`${path}.evidenceRefs[${j}]`, ref))
      c.string(`${path}.waiverReason`, a.waiverReason, { required: false })
      c.timestamp(`${path}.updatedAt`, a.updatedAt)
      if (a.status === 'passed' && (!Array.isArray(a.evidenceRefs) || a.evidenceRefs.length === 0))
        c.fail(`${path}.evidenceRefs`, 'passed criteria require at least one evidence reference')
      if (a.status === 'waived' && !isNonEmptyString(a.waiverReason))
        c.fail(`${path}.waiverReason`, 'is required when status is waived')
    })
  }

  if (c.object('$.leanGate', doc.leanGate)) {
    const g = doc.leanGate
    c.keys('$.leanGate', g, ['status', 'selectedRung', 'decision', 'rejectedAlternatives', 'knownCeiling', 'upgradeTrigger', 'recordedAt'])
    c.enumOf('$.leanGate.status', g.status, LEAN_GATE_STATUSES)
    if (g.selectedRung !== null && g.selectedRung !== undefined)
      c.enumOf('$.leanGate.selectedRung', g.selectedRung, LEAN_RUNGS)
    c.string('$.leanGate.decision', g.decision, { required: false })
    if (c.array('$.leanGate.rejectedAlternatives', g.rejectedAlternatives))
      g.rejectedAlternatives.forEach((alt, i) => c.string(`$.leanGate.rejectedAlternatives[${i}]`, alt))
    c.string('$.leanGate.knownCeiling', g.knownCeiling, { required: false })
    c.string('$.leanGate.upgradeTrigger', g.upgradeTrigger, { required: false })
    c.timestamp('$.leanGate.recordedAt', g.recordedAt, { required: false })
    if (g.status === 'passed') {
      if (!LEAN_RUNGS.includes(g.selectedRung))
        c.fail('$.leanGate.selectedRung', 'is required when the gate has passed')
      if (!isNonEmptyString(g.decision))
        c.fail('$.leanGate.decision', 'is required when the gate has passed')
    }
  }

  if (c.object('$.evidence', doc.evidence)) {
    c.keys('$.evidence', doc.evidence, EVIDENCE_KINDS)
    for (const kind of EVIDENCE_KINDS) {
      if (doc.evidence[kind] !== undefined)
        checkEvidenceGroup(c, `$.evidence.${kind}`, doc.evidence[kind])
    }
    for (const kind of ['tests', 'lint', 'types', 'review']) {
      if (doc.evidence[kind] === undefined)
        c.fail(`$.evidence.${kind}`, 'is required')
    }
  }

  if (c.object('$.complexityReview', doc.complexityReview)) {
    const r = doc.complexityReview
    c.keys('$.complexityReview', r, ['status', 'findings', 'estimatedLinesRemovable'])
    c.enumOf('$.complexityReview.status', r.status, COMPLEXITY_REVIEW_STATUSES)
    if (c.array('$.complexityReview.findings', r.findings))
      r.findings.forEach((f, i) => c.string(`$.complexityReview.findings[${i}]`, f))
    if (r.estimatedLinesRemovable !== null && !Number.isInteger(r.estimatedLinesRemovable))
      c.fail('$.complexityReview.estimatedLinesRemovable', 'must be an integer or null')
  }

  if (c.object('$.nextAction', doc.nextAction)) {
    c.keys('$.nextAction', doc.nextAction, ['capability', 'reason', 'humanGate'])
    c.string('$.nextAction.capability', doc.nextAction.capability, { required: false })
    c.string('$.nextAction.reason', doc.nextAction.reason, { required: false })
    c.boolean('$.nextAction.humanGate', doc.nextAction.humanGate)
  }

  if (!Number.isInteger(doc.revision) || doc.revision < 1)
    c.fail('$.revision', 'must be a positive integer')
  c.timestamp('$.createdAt', doc.createdAt)
  c.timestamp('$.updatedAt', doc.updatedAt)

  if (c.issues.length > 0) {
    throw new ValidationError(
      `state document is invalid (${c.issues.length} issue${c.issues.length === 1 ? '' : 's'}): ${c.issues.join('; ')}`,
      { issues: c.issues },
    )
  }
  return doc
}

// ------------------------------------------------------------------ shape --

function emptyEvidenceGroup(status = 'pending') {
  return { status, items: [] }
}

/**
 * @param {object} opts
 * @param {string} opts.repositoryId machine-independent identity (github:owner/repo)
 * @param {string} [opts.now] ISO timestamp override for tests
 * @returns {object} a valid revision-1 state document
 */
function createInitialState({ repositoryId, now = new Date().toISOString() }) {
  return validateState({
    schemaVersion: SCHEMA_VERSION,
    repository: { id: repositoryId },
    phase: 'A',
    state: 'explore',
    status: 'active',
    blockedFrom: null,
    goal: null,
    artifact: null,
    decisions: [],
    openQuestions: [],
    acceptanceCriteria: [],
    leanGate: {
      status: 'pending',
      selectedRung: null,
      decision: null,
      rejectedAlternatives: [],
      knownCeiling: null,
      upgradeTrigger: null,
      recordedAt: null,
    },
    evidence: {
      tests: emptyEvidenceGroup(),
      lint: emptyEvidenceGroup(),
      types: emptyEvidenceGroup('not-configured'),
      review: emptyEvidenceGroup(),
    },
    complexityReview: { status: 'pending', findings: [], estimatedLinesRemovable: null },
    nextAction: { capability: null, reason: null, humanGate: false },
    revision: 1,
    createdAt: now,
    updatedAt: now,
  })
}

module.exports = {
  SCHEMA_VERSION,
  PHASES,
  STATES,
  ACTIVE_STATES,
  STATE_TO_PHASE,
  STATUSES,
  ARTIFACT_TYPES,
  CRITERION_STATUSES,
  EVIDENCE_KINDS,
  EVIDENCE_STATUSES,
  LEAN_GATE_STATUSES,
  LEAN_RUNGS,
  PROTECTED_CONCERNS,
  portabilityViolation,
  validateState,
  createInitialState,
  emptyEvidenceGroup,
}
