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
})
