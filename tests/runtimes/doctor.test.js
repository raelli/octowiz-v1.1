'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { inspectClaudeCode } = require('../../src/runtimes/doctor')

describe('claude Code runtime doctor', () => {
  let home

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'octowiz-doctor-'))
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true })
  })

  afterEach(() => fs.rmSync(home, { recursive: true, force: true }))

  it('reports a ready advisor/workflow setup', () => {
    fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({ advisorModel: 'fable' }))
    const result = inspectClaudeCode({
      home,
      run: () => '2.1.212 (Claude Code)\n',
    })
    expect(result).toMatchObject({
      workflowCapable: true,
      advisorReady: true,
      workflowsDisabled: false,
      ready: true,
    })
  })

  it('does not expose unrelated settings and reports disabled workflows', () => {
    fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({
      advisorModel: 'fable',
      disableWorkflows: true,
      secret: 'do-not-return',
    }))
    const result = inspectClaudeCode({ home, run: () => '2.1.212' })
    expect(result.ready).toBe(false)
    expect(result).not.toHaveProperty('secret')
  })
})
