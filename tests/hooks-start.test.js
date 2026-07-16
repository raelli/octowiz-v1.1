'use strict'

describe('hooks/scripts/start.js', () => {
  beforeEach(() => {
    jest.resetModules()
    process.env.AELLI_LITELLM_BASE = 'https://llm.test'
    process.env.AELLI_AUTH_TOKEN = 'tok'
    jest.mock('../src/a2a-client', () => ({ post: jest.fn().mockResolvedValue(null) }))
    jest.mock('../src/git-context', () => ({
      captureContext: jest.fn().mockReturnValue({
        sessionId: 's1',
        repoRoot: '/repo',
        repo: 'origin',
        cwd: '/repo',
      }),
      getLiveContext: jest.fn().mockReturnValue({ branch: 'main', modifiedFiles: [] }),
    }))
  })

  afterEach(() => {
    delete process.env.AELLI_LITELLM_BASE
    delete process.env.AELLI_AUTH_TOKEN
    jest.restoreAllMocks()
  })

  it('posts session-start with repository context', async () => {
    const { handleStart } = require('../hooks/scripts/start')
    const { post } = require('../src/a2a-client')

    await handleStart({ session_id: 's1', cwd: '/repo' })

    expect(post).toHaveBeenCalledWith(
      'session-start',
      expect.objectContaining({ sessionId: 's1', branch: 'main' }),
      expect.objectContaining({ sync: true, timeoutMs: 500 }),
    )
  })

  it('fails open when AELLI is unavailable', async () => {
    const { post } = require('../src/a2a-client')
    post.mockRejectedValueOnce(new Error('unreachable'))
    const { handleStart } = require('../hooks/scripts/start')

    await expect(handleStart({ session_id: 's1', cwd: '/repo' })).resolves.not.toThrow()
  })

  it('does not spawn processes or touch OS service managers', async () => {
    const childProcess = require('node:child_process')
    const spawn = jest.spyOn(childProcess, 'spawn')
    const execFileSync = jest.spyOn(childProcess, 'execFileSync')
    const { handleStart } = require('../hooks/scripts/start')

    await handleStart({ session_id: 's1', cwd: '/repo' })

    expect(spawn).not.toHaveBeenCalled()
    expect(execFileSync).not.toHaveBeenCalled()
  })
})
