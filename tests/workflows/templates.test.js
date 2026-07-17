'use strict'

const fs = require('node:fs')
const path = require('node:path')

function read(name) {
  return fs.readFileSync(path.resolve(__dirname, '..', '..', 'workflows', name), 'utf8')
}

describe('bundled Dynamic Workflow harnesses', () => {
  it.each(['integra-audit.js', 'integra-migration.js'])(
    '%s is deterministic, bounded, phased, and explicitly routed',
    (name) => {
      const source = read(name)
      expect(source).toContain('model: \'fable\'')
      expect(source).toContain('model: \'sonnet\'')
      expect(source).toContain('Math.min')
      expect(source).toContain(', 16)')
      expect(source).toContain('budget.total')
      expect(source).toContain('phase(\'Plan\')')
      expect(source).toContain('.filter(Boolean)')
      expect(source).not.toContain('Date.now(')
      expect(source).not.toContain('Math.random(')
      expect(source).not.toMatch(/new Date\(\)/)
      expect(source).not.toMatch(/\b(require|process|Bun|Deno)\b/)
    },
  )

  it('keeps the audit read-only', () => {
    expect(read('integra-audit.js')).not.toContain('isolation: \'worktree\'')
  })

  it('isolates every migration worker in a worktree', () => {
    expect(read('integra-migration.js')).toContain('isolation: \'worktree\'')
  })
})
