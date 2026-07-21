'use strict'

// Condition evaluator for the capability registry. Each condition is a pure
// function that inspects observable repository facts (files, package.json) and
// returns a boolean. No network, no LLM, no side effects.
//
// Conditions are referenced by string name in registry.json `when` clauses.
// The evaluator builds a Set<string> of satisfied conditions for a given repo.

const fs = require('node:fs')
const path = require('node:path')

// ──────────────────────────────────────────── individual conditions

/**
 * True when the repository has substantial documentation:
 * CONTEXT.md, docs/adr/, or a docs/ directory with at least one .md file.
 * @param {ConditionContext} ctx
 * @returns {boolean} The resulting value.
 */
function docsExist(ctx) {
  if (ctx.fileExists('CONTEXT.md'))
    return true
  if (ctx.fileExists('docs/adr'))
    return true
  if (ctx.fileExists('docs')) {
    // Check for at least one markdown file in docs/
    try {
      const entries = fs.readdirSync(path.resolve(ctx.cwd, 'docs'))
      return entries.some(e => e.endsWith('.md'))
    }
    catch {
      return false
    }
  }
  return false
}

/**
 * True when the repository is part of the Vue/Nuxt/Vite ecosystem.
 * Checks package.json dependencies and devDependencies for relevant packages.
 * @param {ConditionContext} ctx
 * @returns {boolean} The resulting value.
 */
function vueNuxtViteEcosystem(ctx) {
  const pkg = ctx.packageJson
  if (!pkg)
    return false

  const markers = ['vue', 'nuxt', 'vite', 'vitest', 'unocss', '@unocss/', 'vueuse', '@vueuse/']
  const allDeps = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
    ...pkg.peerDependencies,
  }

  return Object.keys(allDeps).some(dep =>
    markers.some(m => dep === m || dep.startsWith(m)),
  )
}

/**
 * True when the repository has a test setup: test directory, or a test/spec
 * script in package.json.
 * @param {ConditionContext} ctx
 * @returns {boolean} The resulting value.
 */
function hasTests(ctx) {
  if (ctx.fileExists('tests') || ctx.fileExists('test') || ctx.fileExists('__tests__'))
    return true
  const pkg = ctx.packageJson
  if (pkg && pkg.scripts) {
    return !!(pkg.scripts.test || pkg.scripts.spec)
  }
  return false
}

/**
 * True when the repository uses TypeScript: tsconfig.json exists.
 * @param {ConditionContext} ctx
 * @returns {boolean} The resulting value.
 */
function hasTypescript(ctx) {
  return ctx.fileExists('tsconfig.json') || ctx.fileExists('tsconfig.base.json')
}

/**
 * True when the repository has Python tooling: pyproject.toml or requirements.txt.
 * @param {ConditionContext} ctx
 * @returns {boolean} The resulting value.
 */
function hasPython(ctx) {
  return ctx.fileExists('pyproject.toml') || ctx.fileExists('requirements.txt') || ctx.fileExists('setup.py')
}

/**
 * True when the repository is a pnpm workspace.
 * @param {ConditionContext} ctx
 * @returns {boolean} The resulting value.
 */
function pnpmWorkspace(ctx) {
  return ctx.fileExists('pnpm-workspace.yaml') || ctx.fileExists('pnpm-workspace.yml')
}

// ──────────────────────────────────────────── condition registry

/** @type {Record<string, (ctx: ConditionContext) => boolean>} */
const CONDITIONS = {
  'docs-exist': docsExist,
  'vue-nuxt-vite-ecosystem': vueNuxtViteEcosystem,
  'has-tests': hasTests,
  'has-typescript': hasTypescript,
  'has-python': hasPython,
  'pnpm-workspace': pnpmWorkspace,
}

// ──────────────────────────────────────────── composition operators

/**
 * Compose conditions with AND: all must be true.
 * @param {...string} names condition names
 * @returns {(ctx: ConditionContext) => boolean} The resulting value.
 */
function and(...names) {
  return ctx => names.every(name => evaluateCondition(name, ctx))
}

/**
 * Compose conditions with OR: at least one must be true.
 * @param {...string} names condition names
 * @returns {(ctx: ConditionContext) => boolean} The resulting value.
 */
function or(...names) {
  return ctx => names.some(name => evaluateCondition(name, ctx))
}

/**
 * Negate a condition.
 * @param {string} name condition name
 * @returns {(ctx: ConditionContext) => boolean} The resulting value.
 */
function not(name) {
  return ctx => !evaluateCondition(name, ctx)
}

// ──────────────────────────────────────────── evaluation

/**
 * Evaluate a single condition by name. Unknown conditions return false
 * (fail-open for optional resolvers, fail-closed for enabling features).
 * @param {string} name
 * @param {ConditionContext} ctx
 * @returns {boolean} The resulting value.
 */
function evaluateCondition(name, ctx) {
  const fn = CONDITIONS[name]
  if (!fn)
    return false
  try {
    return !!fn(ctx)
  }
  catch {
    return false
  }
}

/**
 * Evaluate all registered conditions against a context and return the set
 * of satisfied condition names. This is the primary integration point — pass
 * the result as `satisfiedConditions` to `resolveCapability()`.
 * @param {ConditionContext} ctx
 * @returns {Set<string>} The resulting value.
 */
function evaluateAll(ctx) {
  const satisfied = new Set()
  for (const name of Object.keys(CONDITIONS)) {
    if (evaluateCondition(name, ctx))
      satisfied.add(name)
  }
  return satisfied
}

// ──────────────────────────────────────────── context builder

/**
 * @typedef {object} ConditionContext
 * @property {string} cwd - repository root (absolute path)
 * @property {object|null} packageJson - parsed package.json or null
 * @property {(relativePath: string) => boolean} fileExists - check file/dir existence
 */

/**
 * Build a ConditionContext from a repository root path. Reads package.json
 * once; fileExists uses synchronous stat for simplicity and reliability.
 * @param {string} cwd absolute path to repository root
 * @returns {ConditionContext} The resulting value.
 */
function buildContext(cwd) {
  let packageJson = null
  try {
    const raw = fs.readFileSync(path.resolve(cwd, 'package.json'), 'utf8')
    packageJson = JSON.parse(raw)
  }
  catch {
    // No package.json or invalid — that's fine
  }

  return {
    cwd,
    packageJson,
    fileExists(relativePath) {
      try {
        fs.statSync(path.resolve(cwd, relativePath))
        return true
      }
      catch {
        return false
      }
    },
  }
}

module.exports = {
  CONDITIONS,
  evaluateCondition,
  evaluateAll,
  buildContext,
  // Composition operators
  and,
  or,
  not,
  // Individual conditions (exported for testing)
  docsExist,
  vueNuxtViteEcosystem,
  hasTests,
  hasTypescript,
  hasPython,
  pnpmWorkspace,
}
