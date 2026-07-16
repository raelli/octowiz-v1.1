#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const config = require('../../src/config')
const logger = require('../../src/logger')

function appendLog(message) {
  try {
    fs.mkdirSync(config.cacheDir(), { recursive: true })
    fs.appendFileSync(config.logFile(), `[${new Date().toISOString()}] ${message}\n`)
  }
  catch {}
}

async function handleStart(input) {
  const { post } = require('../../src/a2a-client')
  const { captureContext, getLiveContext } = require('../../src/git-context')

  const sessionId = input.session_id || `cc-${Date.now()}-${process.pid}`
  const cwd = input.cwd || process.cwd()

  logger.log('[octowiz - start] session starting', sessionId)

  if (!config.authToken()) {
    logger.warn('[octowiz - start] AELLI_AUTH_TOKEN not set — advisory delivery disabled')
    appendLog('[octowiz - start] AELLI_AUTH_TOKEN not set — advisory delivery disabled')
  }

  const context = captureContext(sessionId, cwd)
  const payload = { ...context, ...getLiveContext(sessionId) }
  await post('session-start', payload, { sync: true, timeoutMs: 500 }).catch((error) => {
    logger.error('[octowiz - start] session-start post failed:', error?.message ?? error)
    appendLog(`[octowiz - start] session-start post failed: ${error?.message ?? error}`)
  })
}

if (require.main === module) {
  let raw = ''
  process.stdin.on('data', chunk => (raw += chunk))
  process.stdin.on('end', async () => {
    let input = {}
    try { input = JSON.parse(raw) }
    catch {}
    try { await handleStart(input) }
    catch (error) {
      logger.error('[octowiz - start] error:', error.message)
      appendLog(`[start] error: ${error.message}`)
    }
    process.exit(0)
  })
}

module.exports = { handleStart }
