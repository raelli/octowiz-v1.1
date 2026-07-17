'use strict'

const EXECUTION_PATTERNS = ['advisor', 'workflow', 'managed-agents']
const MODEL_ALIASES = ['fable', 'sonnet', 'haiku']
const ISOLATION_MODES = ['none', 'worktree', 'managed-session']
const MAX_WORKFLOW_AGENTS = 16

const ADVISOR_DEFAULTS = Object.freeze({
  pattern: 'advisor',
  executorModel: 'sonnet',
  advisorModel: 'fable',
  maxAdvisorCalls: 1,
  effort: 'high',
})

const WORKFLOW_DEFAULTS = Object.freeze({
  pattern: 'workflow',
  plannerModel: 'fable',
  workerModel: 'sonnet',
  synthesizerModel: 'fable',
  effort: 'ultracode',
  writes: false,
  isolation: 'none',
})

const MANAGED_AGENTS_DEFAULTS = Object.freeze({
  pattern: 'managed-agents',
  managedAgentsProfile: 'default',
  writes: false,
  isolation: 'none',
})

function _isModel(value) {
  return MODEL_ALIASES.includes(value) || (typeof value === 'string' && value.startsWith('claude-'))
}

function _positiveInteger(value) {
  return Number.isInteger(value) && value > 0
}

function validateExecutionPolicy(policy) {
  const issues = []
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    issues.push('execution policy must be an object')
    return issues
  }

  if (!EXECUTION_PATTERNS.includes(policy.pattern)) {
    issues.push(`execution.pattern must be one of: ${EXECUTION_PATTERNS.join(', ')}`)
    return issues
  }

  if (policy.pattern === 'advisor') {
    if (!_isModel(policy.executorModel))
      issues.push('execution.executorModel must be a recognized model alias or full Claude model id')
    if (!_isModel(policy.advisorModel))
      issues.push('execution.advisorModel must be a recognized model alias or full Claude model id')
    if (!_positiveInteger(policy.maxAdvisorCalls) || policy.maxAdvisorCalls > 2)
      issues.push('execution.maxAdvisorCalls must be an integer between 1 and 2')
    if (policy.effort !== 'high')
      issues.push('execution.effort must be high for advisor mode')
    return issues
  }

  if (policy.partitionable !== true)
    issues.push(`execution.partitionable must be true for ${policy.pattern} mode`)
  if (typeof policy.scope !== 'string' || !policy.scope.trim())
    issues.push('execution.scope must describe the independent work items')
  if (typeof policy.verification !== 'string' || !policy.verification.trim())
    issues.push('execution.verification must describe the verification strategy')
  if (!_positiveInteger(policy.maxAgents) || policy.maxAgents > MAX_WORKFLOW_AGENTS)
    issues.push(`execution.maxAgents must be an integer between 1 and ${MAX_WORKFLOW_AGENTS}`)
  if (policy.pattern === 'workflow') {
    if (!_isModel(policy.plannerModel))
      issues.push('execution.plannerModel must be a recognized model alias or full Claude model id')
    if (!_isModel(policy.workerModel))
      issues.push('execution.workerModel must be a recognized model alias or full Claude model id')
    if (!_isModel(policy.synthesizerModel))
      issues.push('execution.synthesizerModel must be a recognized model alias or full Claude model id')
    if (policy.effort !== 'ultracode')
      issues.push('execution.effort must be ultracode for workflow mode')
  }
  else {
    const hasAgentId = typeof policy.coordinatorAgentId === 'string' && policy.coordinatorAgentId.trim()
    const hasEnvironmentId = typeof policy.environmentId === 'string' && policy.environmentId.trim()
    const hasProfile = typeof policy.managedAgentsProfile === 'string' && policy.managedAgentsProfile.trim()
    if (!hasProfile && (!hasAgentId || !hasEnvironmentId))
      issues.push('managed-agents mode requires a profile or explicit coordinatorAgentId and environmentId')
    if (Boolean(hasAgentId) !== Boolean(hasEnvironmentId))
      issues.push('execution.coordinatorAgentId and execution.environmentId must be supplied together')
    if (policy.coordinatorAgentVersion !== undefined && !_positiveInteger(policy.coordinatorAgentVersion))
      issues.push('execution.coordinatorAgentVersion must be a positive integer when present')
  }
  if (typeof policy.writes !== 'boolean')
    issues.push('execution.writes must be a boolean')
  if (!ISOLATION_MODES.includes(policy.isolation))
    issues.push(`execution.isolation must be one of: ${ISOLATION_MODES.join(', ')}`)
  if (policy.writes === true && policy.pattern === 'workflow' && policy.isolation !== 'worktree')
    issues.push('writing workflows require execution.isolation=worktree')
  if (policy.writes === true && policy.pattern === 'managed-agents' && policy.isolation !== 'managed-session')
    issues.push('writing managed-agents runs require execution.isolation=managed-session')
  if (policy.budgetTokens !== undefined && !_positiveInteger(policy.budgetTokens))
    issues.push('execution.budgetTokens must be a positive integer when present')
  return issues
}

function advisorPolicy(overrides = {}, reason = 'sequential work uses the safe advisor default') {
  return {
    ...ADVISOR_DEFAULTS,
    ...overrides,
    pattern: 'advisor',
    reason,
  }
}

function resolveExecutionPolicy(requested, defaults = {}) {
  const configuredAdvisor = {
    executorModel: defaults.executorModel ?? ADVISOR_DEFAULTS.executorModel,
    advisorModel: defaults.advisorModel ?? ADVISOR_DEFAULTS.advisorModel,
    maxAdvisorCalls: defaults.maxAdvisorCalls ?? ADVISOR_DEFAULTS.maxAdvisorCalls,
    effort: 'high',
  }

  if (!requested || !['workflow', 'managed-agents'].includes(requested.pattern)) {
    const candidate = advisorPolicy({
      ...configuredAdvisor,
      ...(requested?.pattern === 'advisor' ? requested : {}),
    })
    const issues = validateExecutionPolicy(candidate)
    if (issues.length === 0)
      return candidate
    return {
      ...advisorPolicy(),
      reason: 'invalid advisor configuration; using built-in safe defaults',
      fallbackIssues: issues,
    }
  }

  const candidate = {
    ...(requested.pattern === 'managed-agents' ? MANAGED_AGENTS_DEFAULTS : WORKFLOW_DEFAULTS),
    ...(requested.pattern === 'workflow'
      ? {
          plannerModel: defaults.plannerModel ?? WORKFLOW_DEFAULTS.plannerModel,
          workerModel: defaults.workerModel ?? WORKFLOW_DEFAULTS.workerModel,
          synthesizerModel: defaults.synthesizerModel ?? WORKFLOW_DEFAULTS.synthesizerModel,
        }
      : {}),
    ...requested,
    pattern: requested.pattern,
    ...(requested.pattern === 'workflow' ? { effort: 'ultracode' } : {}),
  }
  const issues = validateExecutionPolicy(candidate)
  if (issues.length > 0) {
    return {
      ...advisorPolicy(configuredAdvisor, `${requested.pattern} request was incomplete or unsafe; using advisor mode`),
      fallbackIssues: issues,
    }
  }
  return {
    ...candidate,
    reason: requested.reason ?? (
      requested.pattern === 'managed-agents'
        ? 'task uses a persisted Managed Agents coordinator with bounded workers'
        : 'task has explicit independent partitions and bounded verification'
    ),
  }
}

module.exports = {
  ADVISOR_DEFAULTS,
  EXECUTION_PATTERNS,
  ISOLATION_MODES,
  MANAGED_AGENTS_DEFAULTS,
  MAX_WORKFLOW_AGENTS,
  MODEL_ALIASES,
  resolveExecutionPolicy,
  validateExecutionPolicy,
}
