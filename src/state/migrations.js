'use strict'

// Deterministic schema migrations for state documents. 0.1 is the first
// released schema, so the table is empty today — the machinery exists so a
// future 0.2 lands as one pure function here instead of ad-hoc patching.

const { MigrationError } = require('./errors')
const { SCHEMA_VERSION } = require('./schema')

// version found on disk -> pure function returning the next-version document.
// Migrations must not mutate their input and must not depend on the clock,
// the environment, or the filesystem.
const MIGRATIONS = {}

function parseVersion(value) {
  const m = typeof value === 'string' ? value.match(/^(\d+)\.(\d+)$/) : null
  return m ? { major: Number(m[1]), minor: Number(m[2]) } : null
}

function isNewerThanSupported(version) {
  const found = parseVersion(version)
  const supported = parseVersion(SCHEMA_VERSION)
  if (!found || !supported)
    return false
  return found.major > supported.major
    || (found.major === supported.major && found.minor > supported.minor)
}

/**
 * Brings a document to the current schema version, or throws MigrationError.
 * Never downgrades: a document written by a newer octowiz is left untouched.
 * @param {object} doc parsed state document of any known version
 * @param {Record<string, (doc: object) => object>} [table] migration table override for tests
 * @returns {{ doc: object, migrated: boolean, fromVersion: string }} migration outcome
 */
function migrate(doc, table = MIGRATIONS) {
  const fromVersion = doc?.schemaVersion
  if (fromVersion === SCHEMA_VERSION)
    return { doc, migrated: false, fromVersion }

  if (isNewerThanSupported(fromVersion)) {
    throw new MigrationError(
      `state file has schemaVersion ${fromVersion}, newer than this build's ${SCHEMA_VERSION} — upgrade octowiz instead of downgrading the file`,
      { fromVersion, supported: SCHEMA_VERSION },
    )
  }

  let current = doc
  const seen = new Set()
  while (current.schemaVersion !== SCHEMA_VERSION) {
    const version = current.schemaVersion
    const step = table[version]
    if (!step) {
      throw new MigrationError(
        `no migration path from schemaVersion ${JSON.stringify(version)} to ${SCHEMA_VERSION}`,
        { fromVersion: version, supported: SCHEMA_VERSION },
      )
    }
    if (seen.has(version))
      throw new MigrationError(`migration loop detected at schemaVersion ${version}`, { fromVersion: version })
    seen.add(version)
    current = step(current)
  }
  return { doc: current, migrated: true, fromVersion }
}

module.exports = { migrate, MIGRATIONS }
