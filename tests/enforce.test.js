'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const enforce = require('../src/state/enforce')
const { runEnforce } = require('../src/state/enforce-cli')

function tmpRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'octowiz-enforce-'))
}

describe('enforce toggle', () => {
  it('defaults to off', () => {
    const cwd = tmpRepo()
    expect(enforce.isEnforced(cwd, {})).toBe(false)
  })

  it('setEnforced(on) round-trips and preserves unrelated config keys', () => {
    const cwd = tmpRepo()
    fs.mkdirSync(path.join(cwd, '.octowiz'), { recursive: true })
    fs.writeFileSync(enforce.configFile(cwd), JSON.stringify({ other: 'kept' }))
    enforce.setEnforced(cwd, true)
    expect(enforce.isEnforced(cwd, {})).toBe(true)
    expect(enforce.readConfig(cwd).other).toBe('kept')
    enforce.setEnforced(cwd, false)
    expect(enforce.isEnforced(cwd, {})).toBe(false)
  })

  it('oCTOWIZ_ENFORCE env overrides config in both directions', () => {
    const cwd = tmpRepo()
    enforce.setEnforced(cwd, false)
    expect(enforce.isEnforced(cwd, { OCTOWIZ_ENFORCE: '1' })).toBe(true)
    expect(enforce.isEnforced(cwd, { OCTOWIZ_ENFORCE: 'on' })).toBe(true)
    enforce.setEnforced(cwd, true)
    expect(enforce.isEnforced(cwd, { OCTOWIZ_ENFORCE: '0' })).toBe(false)
    expect(enforce.isEnforced(cwd, { OCTOWIZ_ENFORCE: 'off' })).toBe(false)
    expect(enforce.isEnforced(cwd, { OCTOWIZ_ENFORCE: 'garbage' })).toBe(true) // falls back to config
  })

  it('broken config file fails open to off', () => {
    const cwd = tmpRepo()
    fs.mkdirSync(path.join(cwd, '.octowiz'), { recursive: true })
    fs.writeFileSync(enforce.configFile(cwd), '{not json')
    expect(enforce.isEnforced(cwd, {})).toBe(false)
  })
})

describe('enforce CLI', () => {
  it('status/on/off drive the toggle and exit 0; unknown command exits 1', () => {
    const cwd = tmpRepo()
    const lines = []
    const io = { cwd, env: {}, log: m => lines.push(m), error: m => lines.push(m) }
    expect(runEnforce(['status'], io)).toBe(0)
    expect(lines.pop()).toContain('off')
    expect(runEnforce(['on'], io)).toBe(0)
    expect(enforce.isEnforced(cwd, {})).toBe(true)
    expect(runEnforce(['status', '--json'], io)).toBe(0)
    expect(JSON.parse(lines.pop()).enforced).toBe(true)
    expect(runEnforce(['off'], io)).toBe(0)
    expect(enforce.isEnforced(cwd, {})).toBe(false)
    expect(runEnforce(['bogus'], io)).toBe(1)
  })
})

describe('commitsSince (spawn-free reflog parse)', () => {
  const HEAD = entries => entries.map(e => `${'0'.repeat(40)} ${'1'.repeat(40)} A U Thor <a@e> ${e.epoch} +0000\t${e.action}: msg`).join('\n')

  it('counts only commit entries at/after the baseline', () => {
    const cwd = tmpRepo()
    fs.mkdirSync(path.join(cwd, '.git', 'logs'), { recursive: true })
    const now = Math.floor(Date.now() / 1000)
    fs.writeFileSync(path.join(cwd, '.git', 'logs', 'HEAD'), HEAD([
      { epoch: now - 5000, action: 'commit' }, // before baseline
      { epoch: now - 10, action: 'commit' },
      { epoch: now - 5, action: 'commit (amend)' },
      { epoch: now - 3, action: 'checkout' }, // not a commit
    ]))
    const since = new Date((now - 100) * 1000).toISOString()
    expect(enforce.commitsSince(cwd, since)).toBe(2)
  })

  it('follows a worktree gitdir redirect', () => {
    const main = tmpRepo()
    const wt = tmpRepo()
    const gitdir = path.join(main, '.git', 'worktrees', 'wt')
    fs.mkdirSync(path.join(gitdir, 'logs'), { recursive: true })
    const now = Math.floor(Date.now() / 1000)
    fs.writeFileSync(path.join(gitdir, 'logs', 'HEAD'), HEAD([{ epoch: now - 1, action: 'commit' }]))
    fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${gitdir}\n`)
    expect(enforce.commitsSince(wt, new Date((now - 100) * 1000).toISOString())).toBe(1)
  })

  it('fails open to zero without a git dir or reflog', () => {
    expect(enforce.commitsSince(tmpRepo(), new Date().toISOString())).toBe(0)
  })
})

describe('decideStopGate', () => {
  const base = { enforced: true, stopHookActive: false, stateExists: true, commitsThisSession: 1, stateUpdatedThisSession: false }

  it('blocks commits with no state update', () => {
    expect(enforce.decideStopGate(base).block).toBe(true)
  })

  it('blocks commits with no state at all, pointing at state init', () => {
    const v = enforce.decideStopGate({ ...base, stateExists: false })
    expect(v.block).toBe(true)
    expect(v.reason).toContain('state init')
  })

  it('yields when state was updated this session', () => {
    expect(enforce.decideStopGate({ ...base, stateUpdatedThisSession: true }).block).toBe(false)
  })

  it('yields with no commits, when not enforced, and after a prior block (stop_hook_active)', () => {
    expect(enforce.decideStopGate({ ...base, commitsThisSession: 0 }).block).toBe(false)
    expect(enforce.decideStopGate({ ...base, enforced: false }).block).toBe(false)
    expect(enforce.decideStopGate({ ...base, stopHookActive: true }).block).toBe(false)
  })
})
