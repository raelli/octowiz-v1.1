'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const {
  CONDITIONS,
  evaluateCondition,
  evaluateAll,
  buildContext,
  and,
  or,
  not,
  docsExist,
  vueNuxtViteEcosystem,
  hasTests,
  hasTypescript,
  hasPython,
  pnpmWorkspace,
} = require('../../src/capabilities/conditions')

// ──────────────────────────────────────────── test helpers

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'octowiz-cond-'))
}

function mockCtx({ files = [], packageJson = null } = {}) {
  const existingFiles = new Set(files)
  return {
    cwd: '/mock',
    packageJson,
    fileExists(p) {
      return existingFiles.has(p)
    },
  }
}

// ──────────────────────────────────────────── docs-exist

describe('conditions — docs-exist', () => {
  it('returns true when CONTEXT.md exists', () => {
    const ctx = mockCtx({ files: ['CONTEXT.md'] })
    expect(docsExist(ctx)).toBe(true)
  })

  it('returns true when docs/adr exists', () => {
    const ctx = mockCtx({ files: ['docs/adr'] })
    expect(docsExist(ctx)).toBe(true)
  })

  it('returns true when docs/ contains a .md file', () => {
    const dir = tmpDir()
    fs.mkdirSync(path.join(dir, 'docs'))
    fs.writeFileSync(path.join(dir, 'docs', 'architecture.md'), '# Arch')
    const ctx = buildContext(dir)
    expect(docsExist(ctx)).toBe(true)
    fs.rmSync(dir, { recursive: true })
  })

  it('returns false when docs/ has no markdown files', () => {
    const dir = tmpDir()
    fs.mkdirSync(path.join(dir, 'docs'))
    fs.writeFileSync(path.join(dir, 'docs', 'logo.svg'), '<svg/>')
    const ctx = buildContext(dir)
    expect(docsExist(ctx)).toBe(false)
    fs.rmSync(dir, { recursive: true })
  })

  it('returns false when nothing matches', () => {
    const ctx = mockCtx({ files: ['src/index.js'] })
    expect(docsExist(ctx)).toBe(false)
  })
})

// ──────────────────────────────────────────── vue-nuxt-vite-ecosystem

describe('conditions — vue-nuxt-vite-ecosystem', () => {
  it('returns true for vue dependency', () => {
    const ctx = mockCtx({ packageJson: { dependencies: { vue: '^3.0.0' } } })
    expect(vueNuxtViteEcosystem(ctx)).toBe(true)
  })

  it('returns true for nuxt devDependency', () => {
    const ctx = mockCtx({ packageJson: { devDependencies: { nuxt: '^3.0.0' } } })
    expect(vueNuxtViteEcosystem(ctx)).toBe(true)
  })

  it('returns true for vite', () => {
    const ctx = mockCtx({ packageJson: { devDependencies: { vite: '^5.0.0' } } })
    expect(vueNuxtViteEcosystem(ctx)).toBe(true)
  })

  it('returns true for vitest', () => {
    const ctx = mockCtx({ packageJson: { devDependencies: { vitest: '^1.0.0' } } })
    expect(vueNuxtViteEcosystem(ctx)).toBe(true)
  })

  it('returns true for unocss', () => {
    const ctx = mockCtx({ packageJson: { devDependencies: { unocss: '^0.50.0' } } })
    expect(vueNuxtViteEcosystem(ctx)).toBe(true)
  })

  it('returns true for @unocss/ scoped package', () => {
    const ctx = mockCtx({ packageJson: { devDependencies: { '@unocss/preset-uno': '^0.50.0' } } })
    expect(vueNuxtViteEcosystem(ctx)).toBe(true)
  })

  it('returns true for @vueuse/ package', () => {
    const ctx = mockCtx({ packageJson: { dependencies: { '@vueuse/core': '^10.0.0' } } })
    expect(vueNuxtViteEcosystem(ctx)).toBe(true)
  })

  it('returns false for react project', () => {
    const ctx = mockCtx({ packageJson: { dependencies: { react: '^18.0.0' }, devDependencies: { jest: '^29.0.0' } } })
    expect(vueNuxtViteEcosystem(ctx)).toBe(false)
  })

  it('returns false when no package.json', () => {
    const ctx = mockCtx({})
    expect(vueNuxtViteEcosystem(ctx)).toBe(false)
  })

  it('returns false when package.json has no deps', () => {
    const ctx = mockCtx({ packageJson: { name: 'empty' } })
    expect(vueNuxtViteEcosystem(ctx)).toBe(false)
  })
})

// ──────────────────────────────────────────── has-tests

describe('conditions — has-tests', () => {
  it('returns true when tests/ directory exists', () => {
    const ctx = mockCtx({ files: ['tests'] })
    expect(hasTests(ctx)).toBe(true)
  })

  it('returns true when test/ directory exists', () => {
    const ctx = mockCtx({ files: ['test'] })
    expect(hasTests(ctx)).toBe(true)
  })

  it('returns true when __tests__/ directory exists', () => {
    const ctx = mockCtx({ files: ['__tests__'] })
    expect(hasTests(ctx)).toBe(true)
  })

  it('returns true when package.json has test script', () => {
    const ctx = mockCtx({ packageJson: { scripts: { test: 'jest' } } })
    expect(hasTests(ctx)).toBe(true)
  })

  it('returns true when package.json has spec script', () => {
    const ctx = mockCtx({ packageJson: { scripts: { spec: 'mocha' } } })
    expect(hasTests(ctx)).toBe(true)
  })

  it('returns false when no tests signal', () => {
    const ctx = mockCtx({ packageJson: { scripts: { start: 'node .' } } })
    expect(hasTests(ctx)).toBe(false)
  })
})

// ──────────────────────────────────────────── has-typescript

describe('conditions — has-typescript', () => {
  it('returns true when tsconfig.json exists', () => {
    const ctx = mockCtx({ files: ['tsconfig.json'] })
    expect(hasTypescript(ctx)).toBe(true)
  })

  it('returns true when tsconfig.base.json exists', () => {
    const ctx = mockCtx({ files: ['tsconfig.base.json'] })
    expect(hasTypescript(ctx)).toBe(true)
  })

  it('returns false when no tsconfig', () => {
    const ctx = mockCtx({ files: ['jsconfig.json'] })
    expect(hasTypescript(ctx)).toBe(false)
  })
})

// ──────────────────────────────────────────── has-python

describe('conditions — has-python', () => {
  it('returns true when pyproject.toml exists', () => {
    const ctx = mockCtx({ files: ['pyproject.toml'] })
    expect(hasPython(ctx)).toBe(true)
  })

  it('returns true when requirements.txt exists', () => {
    const ctx = mockCtx({ files: ['requirements.txt'] })
    expect(hasPython(ctx)).toBe(true)
  })

  it('returns true when setup.py exists', () => {
    const ctx = mockCtx({ files: ['setup.py'] })
    expect(hasPython(ctx)).toBe(true)
  })

  it('returns false when no python signals', () => {
    const ctx = mockCtx({ files: ['package.json'] })
    expect(hasPython(ctx)).toBe(false)
  })
})

// ──────────────────────────────────────────── pnpm-workspace

describe('conditions — pnpm-workspace', () => {
  it('returns true when pnpm-workspace.yaml exists', () => {
    const ctx = mockCtx({ files: ['pnpm-workspace.yaml'] })
    expect(pnpmWorkspace(ctx)).toBe(true)
  })

  it('returns true when pnpm-workspace.yml exists', () => {
    const ctx = mockCtx({ files: ['pnpm-workspace.yml'] })
    expect(pnpmWorkspace(ctx)).toBe(true)
  })

  it('returns false when no workspace file', () => {
    const ctx = mockCtx({ files: ['package.json'] })
    expect(pnpmWorkspace(ctx)).toBe(false)
  })
})

// ──────────────────────────────────────────── composition operators

describe('conditions — and/or/not', () => {
  const ctx = mockCtx({
    files: ['tests', 'tsconfig.json'],
    packageJson: { scripts: { test: 'jest' } },
  })

  it('and() returns true when all conditions are satisfied', () => {
    const fn = and('has-tests', 'has-typescript')
    expect(fn(ctx)).toBe(true)
  })

  it('and() returns false when any condition is unsatisfied', () => {
    const fn = and('has-tests', 'has-python')
    expect(fn(ctx)).toBe(false)
  })

  it('or() returns true when at least one condition is satisfied', () => {
    const fn = or('has-python', 'has-typescript')
    expect(fn(ctx)).toBe(true)
  })

  it('or() returns false when no conditions are satisfied', () => {
    const fn = or('has-python', 'pnpm-workspace')
    expect(fn(ctx)).toBe(false)
  })

  it('not() inverts a condition', () => {
    const fn = not('has-python')
    expect(fn(ctx)).toBe(true)
  })

  it('not() inverts a true condition to false', () => {
    const fn = not('has-tests')
    expect(fn(ctx)).toBe(false)
  })
})

// ──────────────────────────────────────────── evaluateCondition

describe('conditions — evaluateCondition', () => {
  it('evaluates a known condition', () => {
    const ctx = mockCtx({ files: ['tests'] })
    expect(evaluateCondition('has-tests', ctx)).toBe(true)
  })

  it('returns false for unknown condition names', () => {
    const ctx = mockCtx({})
    expect(evaluateCondition('not-a-real-condition', ctx)).toBe(false)
  })

  it('returns false when condition throws', () => {
    // Simulate a broken condition by temporarily overriding
    const original = CONDITIONS['has-tests']
    CONDITIONS['has-tests'] = () => { throw new Error('boom') }
    const ctx = mockCtx({})
    expect(evaluateCondition('has-tests', ctx)).toBe(false)
    CONDITIONS['has-tests'] = original
  })
})

// ──────────────────────────────────────────── evaluateAll

describe('conditions — evaluateAll', () => {
  it('returns set of all satisfied conditions', () => {
    const ctx = mockCtx({
      files: ['tests', 'tsconfig.json', 'pyproject.toml', 'CONTEXT.md'],
      packageJson: { scripts: { test: 'jest' } },
    })
    const satisfied = evaluateAll(ctx)
    expect(satisfied.has('has-tests')).toBe(true)
    expect(satisfied.has('has-typescript')).toBe(true)
    expect(satisfied.has('has-python')).toBe(true)
    expect(satisfied.has('docs-exist')).toBe(true)
    expect(satisfied.has('vue-nuxt-vite-ecosystem')).toBe(false)
    expect(satisfied.has('pnpm-workspace')).toBe(false)
  })

  it('returns empty set when no conditions match', () => {
    const ctx = mockCtx({})
    const satisfied = evaluateAll(ctx)
    expect(satisfied.size).toBe(0)
  })
})

// ──────────────────────────────────────────── buildContext

describe('conditions — buildContext', () => {
  it('builds a working context from a real directory', () => {
    // Use the octowiz-v1.1 repo itself as a test subject
    const ctx = buildContext(path.resolve(__dirname, '../..'))
    expect(ctx.cwd).toBeDefined()
    expect(ctx.packageJson).not.toBeNull()
    expect(ctx.packageJson.name).toBe('octowiz')
    expect(ctx.fileExists('package.json')).toBe(true)
    expect(ctx.fileExists('nonexistent-file.xyz')).toBe(false)
  })

  it('handles missing package.json gracefully', () => {
    const dir = tmpDir()
    const ctx = buildContext(dir)
    expect(ctx.packageJson).toBeNull()
    expect(ctx.fileExists('package.json')).toBe(false)
    fs.rmSync(dir, { recursive: true })
  })
})

// ──────────────────────────────────────────── integration with real repo

describe('conditions — integration against octowiz-v1.1', () => {
  const ctx = buildContext(path.resolve(__dirname, '../..'))

  it('docs-exist is true (docs/ has markdown)', () => {
    expect(evaluateCondition('docs-exist', ctx)).toBe(true)
  })

  it('has-tests is true (tests/ exists)', () => {
    expect(evaluateCondition('has-tests', ctx)).toBe(true)
  })

  it('has-python is true (pyproject.toml exists)', () => {
    expect(evaluateCondition('has-python', ctx)).toBe(true)
  })

  it('vue-nuxt-vite-ecosystem is false (no vue deps)', () => {
    expect(evaluateCondition('vue-nuxt-vite-ecosystem', ctx)).toBe(false)
  })

  it('evaluateAll produces correct set for this repo', () => {
    const satisfied = evaluateAll(ctx)
    expect(satisfied.has('docs-exist')).toBe(true)
    expect(satisfied.has('has-tests')).toBe(true)
    expect(satisfied.has('has-python')).toBe(true)
    expect(satisfied.has('vue-nuxt-vite-ecosystem')).toBe(false)
  })
})
