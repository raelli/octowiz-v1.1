#!/usr/bin/env node
'use strict'

// Octowiz CLI entry point. `state` is the first command group; later
// capability groups mount here the same way.

const [group, ...rest] = process.argv.slice(2)

if (group === 'state') {
  const { runState } = require('../src/state/cli')
  process.exit(runState(rest))
}

if (group === 'capability') {
  const { runCapability } = require('../src/capabilities/cli')
  process.exit(runCapability(rest))
}

if (group === 'runtime') {
  const { runRuntime } = require('../src/runtimes/cli')
  runRuntime(rest).then(code => process.exit(code))
}
else {
  const { USAGE } = require('../src/state/cli')
  console.error(`usage: octowiz <group> [command]\n\ngroups:\n  state        persistent engineering state\n  capability   capability registry resolution\n  runtime      runtime adapter management\n\n${USAGE}`)
  process.exit(group ? 1 : 0)
}
