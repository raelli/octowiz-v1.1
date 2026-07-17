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
})
