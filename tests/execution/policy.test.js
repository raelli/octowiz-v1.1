'use strict'

const {
  MAX_WORKFLOW_AGENTS,
  resolveExecutionPolicy,
  validateExecutionPolicy,
} = require('../../src/execution/policy')

describe('execution policy', () => {
  it('defaults to Sonnet with Fable as a bounded advisor', () => {
    expect(resolveExecutionPolicy()).toMatchObject({
      pattern: 'advisor',
      executorModel: 'sonnet',
      advisorModel: 'fable',
      maxAdvisorCalls: 1,
      effort: 'high',
    })
  })

  it('accepts an explicitly bounded read-only workflow', () => {
    const policy = resolveExecutionPolicy({
      pattern: 'workflow',
      partitionable: true,
      scope: 'one worker per route file',
      verification: 'adversarially verify every finding',
      maxAgents: 8,
      writes: false,
    })
    expect(policy.pattern).toBe('workflow')
    expect(policy.plannerModel).toBe('fable')
    expect(policy.workerModel).toBe('sonnet')
    expect(policy.synthesizerModel).toBe('fable')
    expect(validateExecutionPolicy(policy)).toEqual([])
  })

  it('defaults managed-agents execution to the persisted machine profile', () => {
    const policy = resolveExecutionPolicy({
      pattern: 'managed-agents',
      partitionable: true,
      scope: 'one worker per package',
      verification: 'cross-check findings',
      maxAgents: 4,
      writes: false,
    })
    expect(policy.pattern).toBe('managed-agents')
    expect(policy.managedAgentsProfile).toBe('default')
    expect(validateExecutionPolicy(policy)).toEqual([])
  })

  it('requires worktree isolation for writing workflows', () => {
    const policy = resolveExecutionPolicy({
      pattern: 'workflow',
      partitionable: true,
      scope: 'one worker per component',
      verification: 'run component tests',
      maxAgents: 4,
      writes: true,
      isolation: 'none',
    })
    expect(policy.pattern).toBe('advisor')
    expect(policy.fallbackIssues).toContain('writing workflows require execution.isolation=worktree')
  })

  it('rejects unbounded fan-out', () => {
    const policy = resolveExecutionPolicy({
      pattern: 'workflow',
      partitionable: true,
      scope: 'all files',
      verification: 'run tests',
      maxAgents: MAX_WORKFLOW_AGENTS + 1,
      writes: false,
    })
    expect(policy.pattern).toBe('advisor')
    expect(policy.fallbackIssues.join(' ')).toContain('maxAgents')
  })

  it('does not infer workflow mode from task prose', () => {
    expect(resolveExecutionPolicy({ task: 'audit every file in parallel' }).pattern).toBe('advisor')
  })

  it('accepts persisted Managed Agents coordinator references', () => {
    const policy = resolveExecutionPolicy({
      pattern: 'managed-agents',
      partitionable: true,
      scope: 'one worker per package',
      verification: 'run package tests and synthesize evidence',
      maxAgents: 6,
      coordinatorAgentId: 'agent_coordinator',
      coordinatorAgentVersion: 7,
      environmentId: 'env_octowiz',
      writes: false,
    })
    expect(policy.pattern).toBe('managed-agents')
    expect(policy.isolation).toBe('none')
    expect(validateExecutionPolicy(policy)).toEqual([])
  })

  it('requires managed-session isolation for hosted writes', () => {
    const policy = resolveExecutionPolicy({
      pattern: 'managed-agents',
      partitionable: true,
      scope: 'one worker per package',
      verification: 'run package tests',
      maxAgents: 4,
      coordinatorAgentId: 'agent_coordinator',
      environmentId: 'env_octowiz',
      writes: true,
      isolation: 'worktree',
    })
    expect(policy.pattern).toBe('advisor')
    expect(policy.fallbackIssues).toContain(
      'writing managed-agents runs require execution.isolation=managed-session',
    )
  })
})
