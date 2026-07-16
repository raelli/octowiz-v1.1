'use strict'

const fs = require('node:fs')
const path = require('node:path')

const operations = require('../../src/state/operations')
const runtime = require('../../src/state/runtime')
const store = require('../../src/state/store')
const { makeTempRepo, isolateRuntimeDir, cleanup } = require('./helpers')

describe('runtime separation', () => {
  let repo
  let restoreRuntimeDir

  beforeEach(() => {
    repo = makeTempRepo()
    restoreRuntimeDir = isolateRuntimeDir()
  })

  afterEach(() => {
    restoreRuntimeDir()
    cleanup(repo)
  })

  it('stores runtime state outside the repository', () => {
    const file = runtime.runtimeFile('github:raelli/octowiz-v1.1')
    expect(file.startsWith(path.resolve(repo))).toBe(false)
    expect(file).toContain(process.env.OCTOWIZ_RUNTIME_DIR)

    runtime.registerSession('github:raelli/octowiz-v1.1', { sessionId: 'cc-1', pid: 4242, repositoryRoot: repo })
    expect(fs.existsSync(file)).toBe(true)
    expect(fs.existsSync(path.join(repo, '.octowiz', 'runtime.json'))).toBe(false)
  })

  it('process ids, sessions and local paths never appear in repository state', () => {
    store.init(repo)
    runtime.registerSession('local:x', { sessionId: 'cc-1', pid: 4242, repositoryRoot: repo })

    const raw = fs.readFileSync(store.statePaths(repo).stateFile, 'utf8')
    expect(raw).not.toContain('4242')
    expect(raw).not.toContain('cc-1')
    expect(raw).not.toContain(path.resolve(repo))
    expect(Object.keys(JSON.parse(raw))).not.toEqual(expect.arrayContaining(['pid', 'port', 'sessions']))
  })

  it('registers, heartbeats and releases sessions within a machine', () => {
    const id = 'github:raelli/octowiz-v1.1'
    runtime.registerSession(id, { sessionId: 'cc-1', pid: 1 }, '2026-07-16T00:00:00.000Z')
    runtime.registerSession(id, { sessionId: 'cc-2', pid: 2 }, '2026-07-16T00:01:00.000Z')

    let doc = runtime.readRuntime(id)
    expect(doc.sessions.map(s => s.sessionId)).toEqual(['cc-1', 'cc-2'])

    doc = runtime.heartbeat(id, 'cc-1', '2026-07-16T00:05:00.000Z')
    expect(doc.sessions.find(s => s.sessionId === 'cc-1').lastSeenAt).toBe('2026-07-16T00:05:00.000Z')

    doc = runtime.releaseSession(id, 'cc-1')
    expect(doc.sessions.map(s => s.sessionId)).toEqual(['cc-2'])
  })

  it('re-registering a session refreshes it instead of duplicating', () => {
    const id = 'local:y'
    runtime.registerSession(id, { sessionId: 'cc-1', pid: 1 })
    runtime.registerSession(id, { sessionId: 'cc-1', pid: 99 })
    const doc = runtime.readRuntime(id)
    expect(doc.sessions).toHaveLength(1)
    expect(doc.sessions[0].pid).toBe(99)
  })

  it('session release never touches durable engineering state', () => {
    store.init(repo)
    store.mutate(repo, doc => operations.setGoal(doc, 'survive sessions'))
    const before = fs.readFileSync(store.statePaths(repo).stateFile, 'utf8')

    const id = 'local:z'
    runtime.registerSession(id, { sessionId: 'cc-1', repositoryRoot: repo })
    runtime.releaseSession(id, 'cc-1')

    expect(fs.readFileSync(store.statePaths(repo).stateFile, 'utf8')).toBe(before)
    expect(store.read(repo).goal).toBe('survive sessions')
  })

  it('a broken runtime file degrades to an empty runtime, never an error', () => {
    const id = 'local:broken'
    const file = runtime.runtimeFile(id)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, '{{{')
    const doc = runtime.readRuntime(id)
    expect(doc.sessions).toEqual([])
  })

  it('detects a stray runtime file inside the repository', () => {
    expect(runtime.runtimeFileInsideRepo(repo)).toBeNull()
    fs.mkdirSync(path.join(repo, '.octowiz'), { recursive: true })
    fs.writeFileSync(path.join(repo, '.octowiz', 'runtime.json'), '{}')
    expect(runtime.runtimeFileInsideRepo(repo)).toContain('.octowiz')
  })
})
