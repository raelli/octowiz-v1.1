'use strict'

// `octowiz enforce` — toggle and inspect enforced doctrine mode.

const enforce = require('./enforce')

const USAGE = `usage: octowiz enforce <command>

commands:
  status [--json]   show whether enforced doctrine mode is active and why
  on                require Octowiz routing + doctrine in every session of this repository
  off               return to advisory mode (skills fire by invocation only)`

function runEnforce(argv, { cwd = process.cwd(), env = process.env, log = s => process.stdout.write(`${s}\n`), error = s => process.stderr.write(`${s}\n`) } = {}) {
  const [command, ...rest] = argv
  const json = rest.includes('--json')

  if (command === 'status' || command === undefined) {
    const config = enforce.readConfig(cwd)
    const active = enforce.isEnforced(cwd, env)
    const envRaw = String(env.OCTOWIZ_ENFORCE ?? '').trim()
    const source = envRaw !== '' ? `env OCTOWIZ_ENFORCE=${envRaw}` : (config.enforceDoctrine === true ? '.octowiz/config.json' : 'default')
    if (json)
      log(JSON.stringify({ enforced: active, source, config }, null, 2))
    else
      log(`enforced doctrine mode: ${active ? 'ON' : 'off'} (${source})`)
    return 0
  }

  if (command === 'on' || command === 'off') {
    const doc = enforce.setEnforced(cwd, command === 'on')
    log(`enforced doctrine mode: ${doc.enforceDoctrine ? 'ON' : 'off'} (.octowiz/config.json)`)
    if (doc.enforceDoctrine)
      log('Every session in this repository now starts with the Octowiz mandate injected and cannot end with unaccounted commits (evidence + state transition required). Commit .octowiz/config.json so the toggle travels with the repository. Toggle off with `octowiz enforce off`.')
    return 0
  }

  error(USAGE)
  return command ? 1 : 0
}

module.exports = { runEnforce, USAGE }
