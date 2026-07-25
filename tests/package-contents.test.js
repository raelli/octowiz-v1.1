'use strict'

const { execFileSync } = require('node:child_process')
const path = require('node:path')

describe('npm package contents', () => {
  it('ships the runtime capability registry and pinned provider contract', () => {
    const root = path.resolve(__dirname, '..')
    const output = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
      cwd: root,
      encoding: 'utf8',
    })
    const [{ files }] = JSON.parse(output)
    const packagedPaths = new Set(files.map(file => file.path))

    expect(packagedPaths).toContain('skills/registry.json')
    expect(packagedPaths).toContain('skills/provider-contracts/mattpocock-skills.json')
  })

  it('ships the status line script', () => {
    const root = path.resolve(__dirname, '..')
    const output = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
      cwd: root,
      encoding: 'utf8',
    })
    const [{ files }] = JSON.parse(output)
    const packagedPaths = new Set(files.map(file => file.path))

    // The status line is opt-in via settings.json, so it is only reachable when
    // the file actually lands in the published package.
    expect(packagedPaths).toContain('hooks/octowiz-statusline.sh')
  })
})
