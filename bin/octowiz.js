#!/usr/bin/env node
'use strict'

// Octowiz CLI entry point. `state` is the first command group; later
// capability groups mount here the same way.

const [group, ...rest] = process.argv.slice(2)

if (group === 'state') {
  const { runState } = require('../src/state/cli')
  process.exit(runState(rest))
}

const { USAGE } = require('../src/state/cli')

console.error(`usage: octowiz <group> [command]\n\ngroups:\n  state    persistent engineering state\n\n${USAGE}`)
process.exit(group ? 1 : 0)
