'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { installWorkflows, runWorkflow } = require('../../src/workflows/cli')

describe('workflow installer', () => {
  let cwd
  let home

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'octowiz-workflow-project-'))
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'octowiz-workflow-home-'))
  })

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true })
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('previews a project install without writing', () => {
    const [result] = installWorkflows(['integra-audit'], {
      cwd,
      home,
      dryRun: true,
    })
    expect(result.installed).toBe(false)
    expect(result.destination).toBe(path.join(cwd, '.claude', 'workflows', 'integra-audit.js'))
    expect(fs.existsSync(result.destination)).toBe(false)
  })

  it('installs all templates to user scope', () => {
    const results = installWorkflows(['all'], { cwd, home, scope: 'user' })
    expect(results).toHaveLength(2)
    for (const result of results)
      expect(fs.existsSync(result.destination)).toBe(true)
  })

  it('does not replace existing workflows without force', () => {
    installWorkflows(['integra-audit'], { cwd, home })
    expect(() => installWorkflows(['integra-audit'], { cwd, home })).toThrow(/--force/)
  })

  it('supports JSON CLI output', () => {
    const output = []
    const code = runWorkflow(
      ['install', 'integra-audit', '--dry-run', '--json'],
      { cwd, home, stdout: line => output.push(line) },
    )
    expect(code).toBe(0)
    expect(JSON.parse(output[0])[0].installed).toBe(false)
  })
})
