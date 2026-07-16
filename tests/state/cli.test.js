'use strict'

const fs = require('node:fs')
const path = require('node:path')

const { runState } = require('../../src/state/cli')
const { makeTempRepo, isolateRuntimeDir, cleanup } = require('./helpers')

// Runs a CLI invocation with captured output.
function run(argv, cwd) {
  const out = []
  const err = []
  const code = runState(argv, { cwd, stdout: l => out.push(l), stderr: l => err.push(l) })
  return { code, stdout: out.join('\n'), stderr: err.join('\n') }
}

describe('octowiz state CLI', () => {
  let repo
  let restoreRuntimeDir

  beforeEach(() => {
    repo = makeTempRepo()
    restoreRuntimeDir = isolateRuntimeDir()
  })

  afterEach(() => {
    restoreRuntimeDir()
    cleanup(repo)
  })

  it('init / show / validate round trip', () => {
    expect(run(['init'], repo).code).toBe(0)

    const show = run(['show'], repo)
    expect(show.code).toBe(0)
    expect(show.stdout).toContain('state:     explore')

    const validate = run(['validate'], repo)
    expect(validate.code).toBe(0)
    expect(validate.stdout).toContain('valid')
  })

  it('every command supports --json with parseable output', () => {
    run(['init'], repo)
    const show = run(['show', '--json'], repo)
    expect(JSON.parse(show.stdout).state).toBe('explore')

    const next = run(['next', '--json'], repo)
    expect(JSON.parse(next.stdout)).toMatchObject({
      capability: 'requirements-discovery',
      reason: 'no goal is set',
      humanGate: false,
    })

    run(['set-goal', 'ship', 'it'], repo)
    const history = run(['history', '--json'], repo)
    const events = JSON.parse(history.stdout)
    expect(events.map(e => e.type)).toEqual(['state.initialized', 'goal.updated'])
  })

  it('errors are structured in --json mode and exit 1', () => {
    const result = run(['show', '--json'], repo)
    expect(result.code).toBe(1)
    expect(JSON.parse(result.stderr).error.code).toBe('E_NOT_INITIALIZED')
  })

  it('guard failures list every unmet precondition', () => {
    run(['init'], repo)
    run(['transition', 'define'], repo)
    run(['transition', 'plan'], repo)
    const result = run(['transition', 'implement'], repo)
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('E_GUARD')
    expect(result.stderr).toContain('goal')
  })

  it('supports the full mutation surface end to end', () => {
    run(['init'], repo)
    expect(run(['set-goal', 'persistent', 'state'], repo).code).toBe(0)
    expect(run(['link-artifact', '--type', 'issue', '--id', 'issue-42'], repo).code).toBe(0)
    expect(run(['ask', 'commit ledger by default?', '--non-blocking'], repo).code).toBe(0)
    expect(run(['decide', 'state.json is canonical'], repo).code).toBe(0)
    expect(run(['add-criterion', 'state survives sessions'], repo).code).toBe(0)

    const doc = JSON.parse(run(['show', '--json'], repo).stdout)
    expect(doc.goal).toBe('persistent state')
    expect(doc.artifact.id).toBe('issue-42')
    expect(doc.decisions).toHaveLength(1)
    expect(doc.openQuestions).toHaveLength(1)
    expect(doc.acceptanceCriteria).toHaveLength(1)

    const qid = doc.openQuestions[0].id
    expect(run(['resolve-question', qid, '--answer', 'yes, commit both'], repo).code).toBe(0)

    const acid = doc.acceptanceCriteria[0].id
    expect(run(['criterion', acid, '--status', 'passed', '--evidence', 'jest suite'], repo).code).toBe(0)

    expect(run(['lean', '--rung', 'standard-library', '--decision', 'hand-rolled validation', '--reject', 'ajv'], repo).code).toBe(0)
    expect(run(['evidence', 'tests', 'passed', '--ref', 'jest 9 suites'], repo).code).toBe(0)

    const final = JSON.parse(run(['show', '--json'], repo).stdout)
    expect(final.openQuestions[0].status).toBe('resolved')
    expect(final.acceptanceCriteria[0].status).toBe('passed')
    expect(final.leanGate.selectedRung).toBe('standard-library')
    expect(final.evidence.tests.status).toBe('passed')
  })

  it('rejects a stale --expected-revision with a conflict', () => {
    run(['init'], repo)
    run(['set-goal', 'g1'], repo)
    const result = run(['set-goal', 'g2', '--expected-revision', '1'], repo)
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('E_REVISION_CONFLICT')
    expect(JSON.parse(run(['show', '--json'], repo).stdout).goal).toBe('g1')
  })

  it('repair backs up a corrupted file and reports it', () => {
    run(['init'], repo)
    fs.writeFileSync(path.join(repo, '.octowiz', 'state.json'), 'broken')

    expect(run(['show'], repo).code).toBe(1)

    const result = run(['repair'], repo)
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('preserved')
    expect(run(['show'], repo).code).toBe(0)
  })

  it('warns when machine-local runtime state sits inside the repository', () => {
    run(['init'], repo)
    fs.writeFileSync(path.join(repo, '.octowiz', 'runtime.json'), '{}')
    const result = run(['show'], repo)
    expect(result.code).toBe(0)
    expect(result.stderr).toContain('must not be committed')
  })

  it('prints usage for unknown commands', () => {
    const result = run(['frobnicate'], repo)
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('usage: octowiz state')
  })

  describe('next --json includes resolved capability', () => {
    it('includes resolved provider and command for requirements-discovery', () => {
      run(['init'], repo)
      const result = run(['next', '--json'], repo)
      expect(result.code).toBe(0)
      const data = JSON.parse(result.stdout)
      expect(data.capability).toBe('requirements-discovery')
      expect(data.resolved).toEqual({
        provider: 'mattpocock-skills',
        command: 'grill-me',
      })
    })

    it('includes resolved for implementation capability', () => {
      run(['init'], repo)
      run(['set-goal', 'build feature'], repo)
      run(['link-artifact', '--type', 'issue', '--id', 'i-1'], repo)
      run(['add-criterion', 'it works'], repo)
      run(['transition', 'define'], repo)
      run(['transition', 'plan'], repo)
      run(['lean', '--rung', 'standard-library', '--decision', 'do it', '--reject', 'nothing'], repo)
      run(['transition', 'implement'], repo)
      const result = run(['next', '--json'], repo)
      expect(result.code).toBe(0)
      const data = JSON.parse(result.stdout)
      expect(data.capability).toBe('implementation')
      expect(data.resolved).toEqual({
        provider: 'mattpocock-skills',
        command: 'tdd',
      })
    })

    it('omits resolved field for human-decision (no resolvers)', () => {
      run(['init'], repo)
      run(['set-goal', 'build feature'], repo)
      run(['link-artifact', '--type', 'issue', '--id', 'i-1'], repo)
      run(['add-criterion', 'it works'], repo)
      run(['transition', 'define'], repo)
      run(['transition', 'plan'], repo)
      run(['lean', '--rung', 'standard-library', '--decision', 'do it', '--reject', 'nothing'], repo)
      run(['transition', 'implement'], repo)
      run(['transition', 'blocked', '--reason', 'waiting on approval'], repo)
      const result = run(['next', '--json'], repo)
      expect(result.code).toBe(0)
      const data = JSON.parse(result.stdout)
      expect(data.capability).toBe('human-decision')
      expect(data.resolved).toBeUndefined()
    })

    it('includes resolved in human-readable output', () => {
      run(['init'], repo)
      const result = run(['next'], repo)
      expect(result.code).toBe(0)
      expect(result.stdout).toContain('resolved: mattpocock-skills:grill-me')
    })

    it('shows no resolved line in human output when capability has no resolver', () => {
      run(['init'], repo)
      run(['set-goal', 'build feature'], repo)
      run(['link-artifact', '--type', 'issue', '--id', 'i-1'], repo)
      run(['add-criterion', 'it works'], repo)
      run(['transition', 'define'], repo)
      run(['transition', 'plan'], repo)
      run(['lean', '--rung', 'standard-library', '--decision', 'do it', '--reject', 'nothing'], repo)
      run(['transition', 'implement'], repo)
      run(['transition', 'blocked', '--reason', 'waiting'], repo)
      const result = run(['next'], repo)
      expect(result.code).toBe(0)
      expect(result.stdout).not.toContain('resolved:')
    })
  })
})
