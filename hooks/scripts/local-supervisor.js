'use strict'

const { spawn } = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')

const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || path.join(__dirname, '../..')
const host = '127.0.0.1'
const port = Number(process.env.OCTOWIZ_LOCAL_PORT || 8764)
const idleMs = Number(process.env.OCTOWIZ_IDLE_TIMEOUT_MS || 