# Octowiz Stages 3–5: Multi-Session Implementation Plan
> **Historical plan:** This document records the original stages 3–5 design and is not
> an active routing contract. Command examples below predate the pinned Matt Pocock
> skills 1.1 provider contract. Use `skills/registry.json`,
> `skills/provider-contracts/mattpocock-skills.json`, and
> `skills/octowiz-workflow/SKILL.md` for current behavior.

## Overview

Three stages, broken into focused sessions that each produce a mergeable PR with tests. Sessions are designed to be completed independently by a coding agent or human in one sitting (1–3 hours of focused work each).

---

## Stage 3: Capability Resolution

**Goal:** Replace hardcoded skill names in routing with abstract capabilities resolved through a registry.

### Session 3.1 — Capability Registry Core

**Branch:** `feat/capability-registry`

Deliverables:
- `src/capabilities/registry.js` — the registry loader and resolver
- `src/capabilities/schema.js` — capability descriptor validation
- `skills/registry.json` — the default registry manifest
- `tests/capabilities/registry.test.js`

Design:
```json
// skills/registry.json
{
  "schemaVersion": "0.1",
  "capabilities": {
    "requirements-discovery": {
      "description": "Explore and challenge product requirements",
      "resolvers": [
        { "provider": "mattpocock-skills", "command": "grill-me", "priority": 1 },
        { "provider": "mattpocock-skills", "command": "grill-with-docs", "priority": 2, "when": "docs-exist" }
      ]
    },
    "plan-validation": {
      "description": "Challenge a plan before implementation",
      "resolvers": [
        { "provider": "mattpocock-skills", "command": "grill-with-docs", "priority": 1, "when": "docs-exist" },
        { "provider": "mattpocock-skills", "command": "grill-me", "priority": 2 }
      ]
    },
    "implementation": {
      "description": "TDD implementation of a scoped slice",
      "resolvers": [
        { "provider": "mattpocock-skills", "command": "tdd", "priority": 1 }
      ]
    },
    "diagnosis": {
      "description": "Root-cause analysis of unexpected behavior",
      "resolvers": [
        { "provider": "mattpocock-skills", "command": "diagnose", "priority": 1 }
      ]
    },
    "verification": {
      "description": "Run automated checks and collect evidence",
      "resolvers": [
        { "provider": "octowiz-native", "command": "verify", "priority": 1 }
      ]
    },
    "code-review": {
      "description": "Review implementation against requirements and architecture",
      "resolvers": [
        { "provider": "mattpocock-skills", "command": "zoom-out", "priority": 1 },
        { "provider": "octowiz-native", "command": "complexity-review", "priority": 2 }
      ]
    },
    "handoff-or-ship": {
      "description": "Produce a compact handoff or prepare a PR",
      "resolvers": [
        { "provider": "mattpocock-skills", "command": "handoff", "priority": 1 }
      ]
    },
    "lean-design-check": {
      "description": "Lean engineering gate evaluation",
      "resolvers": [
        { "provider": "octowiz-native", "command": "lean-gate", "priority": 1 }
      ]
    },
    "definition": {
      "description": "Define scope and acceptance criteria from a goal",
      "resolvers": [
        { "provider": "mattpocock-skills", "command": "to-prd", "priority": 1 },
        { "provider": "mattpocock-skills", "command": "to-issues", "priority": 2 }
      ]
    },
    "decision-resolution": {
      "description": "Resolve blocking open questions",
      "resolvers": [
        { "provider": "mattpocock-skills", "command": "grill-me", "priority": 1 }
      ]
    }
  },
  "providers": {
    "mattpocock-skills": {
      "type": "skill-pack",
      "required": true,
      "install": "mattpocock-skills"
    },
    "antfu-skills": {
      "type": "skill-pack",
      "required": false,
      "install": "antfu-skills",
      "when": "vue-nuxt-vite-ecosystem"
    },
    "octowiz-native": {
      "type": "builtin",
      "required": true
    }
  }
}
```

Key decisions:
- Registry is a static JSON file, not a database. Lean gate: file is enough until we need dynamic registration.
- `when` conditions are string identifiers resolved by a condition evaluator (session 3.2).
- `priority` determines selection order when multiple resolvers satisfy conditions.
- Resolvers are ordered; first match wins unless explicitly overridden.

Acceptance criteria:
- [ ] `resolveCapability(name, context)` returns the best resolver or null
- [ ] Unknown capabilities return null, not an error
- [ ] Registry validates on load; malformed registries throw at startup
- [ ] Provider availability is checked (required vs optional)
- [ ] All existing capability names from `src/state/next.js` have registry entries

---

### Session 3.2 — Condition Evaluator

**Branch:** `feat/capability-conditions`

Deliverables:
- `src/capabilities/conditions.js` — evaluates `when` clauses against repo context
- `tests/capabilities/conditions.test.js`

Conditions to implement:
```
docs-exist          — CONTEXT.md, docs/adr/, or substantial docs/ directory present
vue-nuxt-vite-ecosystem — package.json contains vue, nuxt, vite, vitest, unocss, or vueuse deps
has-tests           — test directory or test script in package.json exists
has-typescript      — tsconfig.json exists or .ts files present
has-python          — pyproject.toml or requirements.txt present
pnpm-workspace      — pnpm-workspace.yaml exists
```

Design:
- Conditions receive `{ cwd, packageJson?, fileExists() }` — observable repo facts only.
- Conditions are pure functions; no network, no LLM.
- New conditions can be added without changing the evaluator (registry maps string → function).

Acceptance criteria:
- [ ] Each condition is a named, testable function
- [ ] Conditions are composable (`and`, `or`, `not` over string identifiers)
- [ ] Missing context gracefully returns false (fail-open for optional resolvers)
- [ ] Integration test: resolve a capability with conditions against a mock repo

---

### Session 3.3 — Wire Capability Resolution into State + Workflow Skill

**Branch:** `feat/capability-routing-integration`

Deliverables:
- Modify `src/state/next.js` to call `resolveCapability()` and attach the resolved command to its return value
- Modify `skills/octowiz-workflow/SKILL.md` to use resolved capabilities instead of hardcoded skill references
- Add `octowiz capability resolve <name> [--json]` CLI subcommand
- `tests/capabilities/integration.test.js`

Changes to `resolveNextAction()`:
```js
// Before: returns { capability: 'implementation', reason, humanGate }
// After:  returns { capability: 'implementation', resolved: { provider, command }, reason, humanGate }
```

The workflow SKILL.md becomes a template that references capabilities by name and tells the agent to invoke the resolved command. The skill no longer hardcodes `/mattpocock-skills:tdd` — it says "invoke the resolved command for the `implementation` capability."

Acceptance criteria:
- [ ] `octowiz state next --json` includes `resolved` field with provider and command
- [ ] When no resolver matches, `resolved` is null and the skill can still operate (fail-open)
- [ ] The workflow skill references capabilities, not hardcoded skill paths
- [ ] Existing tests still pass (no behavioral regression)
- [ ] End-to-end: init state → set goal → `octowiz state next` → returns resolved capability

---

### Session 3.4 — Repository-Specific Registry Overrides

**Branch:** `feat/capability-overrides`

Deliverables:
- Support `.octowiz/capabilities.json` as a repository-local override/extension
- Merge logic: repo overrides extend or replace specific capability resolvers
- `tests/capabilities/overrides.test.js`

Design:
- Repo registry is optional. When present, its entries are merged over the default.
- A repo can add new capabilities, add resolvers to existing ones, or disable a resolver.
- Merge is shallow per capability (repo replaces the entire resolver list for a given capability if specified).

Acceptance criteria:
- [ ] Default registry works unchanged when no repo override exists
- [ ] Repo override can add a new capability
- [ ] Repo override can replace resolvers for an existing capability
- [ ] Repo override can disable a provider (`"enabled": false`)
- [ ] Schema validation catches malformed overrides before merging

---

## Stage 4: Runtime Abstraction

**Goal:** Create adapters so Octowiz can coordinate work across different coding runtimes without coupling to Claude Code internals.

### Session 4.1 — Runtime Adapter Interface

**Branch:** `feat/runtime-adapter-interface`

Deliverables:
- `src/runtimes/adapter.js` — abstract interface (JSDoc contract, not a class hierarchy)
- `src/runtimes/registry.js` — runtime registration and selection
- `src/runtimes/types.js` — shared event and response types
- `tests/runtimes/adapter.test.js`

Interface contract:
```js
/**
 * @typedef {object} RuntimeAdapter
 * @property {string} id - unique runtime identifier
 * @property {string} name - human display name
 * @property {() => Promise<boolean>} isAvailable - can this runtime be reached?
 * @property {(task: TaskEnvelope) => Promise<TaskResult>} dispatch - send work
 * @property {() => Promise<RuntimeStatus>} status - health/session info
 * @property {(event: OctowizEvent) => void} notify - fire-and-forget event push
 */

/**
 * @typedef {object} TaskEnvelope
 * @property {string} capability - resolved capability name
 * @property {string} command - resolved command
 * @property {object} context - repo state, goal, criteria, evidence
 * @property {object} [options] - runtime-specific overrides
 */

/**
 * @typedef {object} TaskResult
 * @property {'completed'|'failed'|'deferred'|'human-gate'} status
 * @property {object} [evidence] - machine-readable output
 * @property {string} [summary] - human-readable summary
 * @property {string[]} [artifacts] - file paths or URLs produced
 */
```

Acceptance criteria:
- [ ] Interface is documented and testable against a mock adapter
- [ ] Registry can register/deregister adapters at runtime
- [ ] `getAvailableRuntimes()` returns adapters that respond to `isAvailable()`
- [ ] `selectRuntime(preference?)` returns the best available adapter
- [ ] Unknown runtime IDs return null, not throw

---

### Session 4.2 — Claude Code Adapter

**Branch:** `feat/runtime-claude-code`

Deliverables:
- `src/runtimes/claude-code.js` — adapter for Claude Code (the current default)
- Wire existing hook scripts and daemon dispatch through the adapter interface
- `tests/runtimes/claude-code.test.js`

Design:
- This is largely a refactor: the existing `hooks/scripts/`, `src/daemon.js`, and `src/a2a-client.js` already implement Claude Code coordination.
- The adapter wraps these into the `RuntimeAdapter` contract.
- `dispatch()` for Claude Code means "the active Claude Code session will execute this" — it's advisory routing, not remote execution.
- `notify()` uses the existing `PostToolUse` / `UserPromptSubmit` event forwarding.

Acceptance criteria:
- [ ] Existing hooks still function unchanged
- [ ] `claudeCode.isAvailable()` checks supervisor health endpoint
- [ ] `claudeCode.status()` returns session lease info from runtime store
- [ ] Dispatch produces the same AELLI-bound messages as before
- [ ] No behavioral regression in existing test suite

---

### Session 4.3 — Headless/OpenCode Adapter (Stub)

**Branch:** `feat/runtime-opencode-stub`

Deliverables:
- `src/runtimes/opencode.js` — adapter stub for OpenCode/headless runtimes
- `src/runtimes/daytona.js` — adapter stub for Daytona sandboxed execution
- `tests/runtimes/opencode.test.js`

Design:
- These are capability stubs that declare the interface but return `deferred` for dispatch.
- `isAvailable()` checks for OpenCode process / Daytona API reachability.
- The stubs make it possible to select a runtime in configuration without implementing full execution.
- Real implementation comes when those runtimes are actually deployed.

Acceptance criteria:
- [ ] Stubs register correctly in the runtime registry
- [ ] `isAvailable()` returns false when the runtime isn't running
- [ ] `dispatch()` returns `{ status: 'deferred', reason: 'runtime not implemented' }`
- [ ] Registry correctly falls back to Claude Code when stubs are unavailable

---

### Session 4.4 — Unified Event Protocol

**Branch:** `feat/runtime-event-protocol`

Deliverables:
- `src/runtimes/events.js` — normalized event envelope for all runtimes
- Refactor existing hook event payloads to use the normalized envelope
- `tests/runtimes/events.test.js`

Event envelope:
```js
{
  type: 'session.started' | 'session.ended' | 'tool.used' | 'prompt.submitted' | 'task.dispatched' | 'task.completed' | ...,
  runtime: 'claude-code' | 'opencode' | 'daytona' | ...,
  sessionId: string,
  repositoryId: string,
  timestamp: ISO-8601,
  payload: { ... runtime-specific data ... }
}
```

Acceptance criteria:
- [ ] All existing hook events flow through the envelope
- [ ] Envelope is validated (missing fields rejected)
- [ ] Downstream consumers (AELLI forwarding, ledger append) receive normalized events
- [ ] Runtime-specific payload is preserved but wrapped, not lost
- [ ] No behavioral change to external AELLI API calls

---

### Session 4.5 — Runtime Selection from State + Config

**Branch:** `feat/runtime-selection`

Deliverables:
- Add `runtime` preference to `.octowiz/capabilities.json` or a new `.octowiz/config.json`
- `octowiz runtime list` / `octowiz runtime select <id>` CLI commands
- `src/state/next.js` returns `runtime` in its recommendation when state has a preference
- `tests/runtimes/selection.test.js`

Acceptance criteria:
- [ ] Default runtime is `claude-code` when no preference is set
- [ ] Config can set a preferred runtime per-repository
- [ ] `octowiz state next --json` includes `runtime` field
- [ ] Runtime selection respects availability (falls back if preferred is unavailable)
- [ ] CLI shows available vs configured vs active runtimes

---

## Stage 5: Multiplayer & Autonomous Execution

**Goal:** Enable multiple agents/sessions to work on the same repository concurrently with conflict detection, ownership, and signed evidence.

### Session 5.1 — Session Ledger and Ownership Model

**Branch:** `feat/multiplayer-session-ledger`

Deliverables:
- `src/multiplayer/sessions.js` — session registry with ownership claims
- Extend runtime store (`~/.cache/octowiz/<repo-id>/runtime.json`) with multi-session tracking
- `src/multiplayer/ownership.js` — file/worktree/task ownership claims
- `tests/multiplayer/sessions.test.js`

Design:
```json
// runtime.json sessions array
{
  "sessions": [
    {
      "id": "session-abc",
      "runtime": "claude-code",
      "actor": "human-assisted",
      "worktree": null,
      "ownedFiles": ["src/capabilities/registry.js"],
      "ownedTask": "issue-42",
      "lease": { "expiresAt": "...", "token": "..." },
      "startedAt": "...",
      "lastHeartbeat": "..."
    }
  ]
}
```

Ownership rules:
- A file can be owned by at most one session at a time.
- Ownership is advisory (warning) unless `strict` mode is enabled.
- Stale leases (no heartbeat for > TTL) are automatically released.
- Worktree isolation removes file-level conflicts entirely.

Acceptance criteria:
- [ ] Sessions can register and claim file/task ownership
- [ ] Ownership conflicts are detected and reported
- [ ] Stale sessions are expired based on heartbeat TTL
- [ ] Concurrent `registerSession()` calls with same file produce conflict
- [ ] Ownership info is never written to repository state (stays in runtime store)

---

### Session 5.2 — Worktree Isolation

**Branch:** `feat/multiplayer-worktrees`

Deliverables:
- `src/multiplayer/worktrees.js` — create, list, cleanup git worktrees
- `octowiz worktree create <branch>` / `list` / `remove` CLI
- Integration with session ownership (worktree = implicit file scope)
- `tests/multiplayer/worktrees.test.js`

Design:
- Each autonomous agent session gets its own worktree.
- Worktrees are created under `.octowiz/worktrees/` (gitignored) or a configurable location.
- When a session owns a worktree, it implicitly owns all files within it (no file-level claims needed).
- Worktree cleanup happens on session end or stale expiry.

Acceptance criteria:
- [ ] `octowiz worktree create` creates a git worktree and registers it
- [ ] Session with a worktree doesn't conflict with main-tree sessions on different files
- [ ] Worktree removal cleans up git state and ownership
- [ ] Stale worktrees are warned about but not auto-deleted (human gate)
- [ ] Tests work without network access (local git operations only)

---

### Session 5.3 — Conflict Detection

**Branch:** `feat/multiplayer-conflict-detection`

Deliverables:
- `src/multiplayer/conflicts.js` — detect overlapping changes across sessions/worktrees
- Pre-merge conflict check (diff base comparison)
- Warning system for concurrent edits to same logical area
- `tests/multiplayer/conflicts.test.js`

Design:
- Track which files each session has modified (from `PostToolUse` events).
- When session B modifies a file that session A has pending changes on, emit a conflict warning.
- Before merge, run `git merge-tree` or equivalent to detect textual conflicts early.
- Conflict warnings are advisory by default; `strict` mode blocks concurrent modification.

Acceptance criteria:
- [ ] File-level overlap between two sessions produces a warning event
- [ ] Pre-merge check identifies textual conflicts before attempting merge
- [ ] Warnings include which sessions conflict and on which files
- [ ] No false positives when sessions work on entirely separate files
- [ ] Strict mode blocks the second session's dispatch with an explanatory error

---

### Session 5.4 — Signed Evidence Bundles

**Branch:** `feat/multiplayer-signed-evidence`

Deliverables:
- `src/multiplayer/evidence-bundle.js` — produce and verify evidence bundles
- Bundle format: JSON envelope + SHA-256 of associated commit + evidence items
- `octowiz evidence bundle [--verify]` CLI
- `tests/multiplayer/evidence-bundle.test.js`

Bundle format:
```json
{
  "bundleVersion": "0.1",
  "repositoryId": "github:raelli/octowiz-v1.1",
  "commit": "abc123",
  "commitSha256": "...",
  "session": "session-abc",
  "runtime": "claude-code",
  "timestamp": "...",
  "evidence": [
    { "kind": "tests", "status": "passed", "ref": "jest: 42 suites", "command": "pnpm test", "exitCode": 0 },
    { "kind": "lint", "status": "passed", "ref": "eslint: 0 errors" }
  ],
  "criteria": [
    { "id": "ac-001", "status": "passed", "evidenceRefs": ["..."] }
  ],
  "signature": {
    "algorithm": "hmac-sha256",
    "key_id": "local-machine-key",
    "value": "..."
  }
}
```

Acceptance criteria:
- [ ] Bundle is produced from current state + commit
- [ ] Bundle includes all evidence items tied to the commit
- [ ] Verification checks SHA-256 of commit matches
- [ ] Signature is optional (enabled when a signing key is configured)
- [ ] Tampered bundles fail verification with a clear message
- [ ] Bundle can be attached to a PR or stored in `.octowiz/bundles/`

---

### Session 5.5 — Autonomous Task Leases

**Branch:** `feat/multiplayer-task-leases`

Deliverables:
- `src/multiplayer/task-leases.js` — claim, renew, release, expire task leases
- Integration with the existing `src/task-queue-client.js`
- Lease-aware dispatch: only one session works a task at a time
- `tests/multiplayer/task-leases.test.js`

Design:
- A task lease grants exclusive execution rights for a bounded duration.
- Leases must be renewed before expiry (heartbeat pattern).
- Expired leases are reclaimable by another session.
- The task queue client already has claim/release concepts; this adds TTL, renewal, and conflict detection.

Acceptance criteria:
- [ ] `claimTask(taskId, sessionId)` returns a lease token or conflict error
- [ ] `renewLease(token)` extends expiry
- [ ] Expired leases are automatically released on next claim attempt
- [ ] Double-claim by same session is idempotent
- [ ] Double-claim by different session returns conflict with owner info
- [ ] Integration with task queue: dispatched tasks require an active lease

---

### Session 5.6 — Shared Steering and Human Gates

**Branch:** `feat/multiplayer-human-steering`

Deliverables:
- `src/multiplayer/steering.js` — human override commands that affect all sessions
- `octowiz pause` / `octowiz resume` / `octowiz redirect <session> <capability>`
- Pause halts all autonomous dispatch; resume continues
- `tests/multiplayer/steering.test.js`

Design:
- `pause` writes a flag to runtime state; all adapters check before dispatch.
- `redirect` changes a session's current task/capability without killing it.
- Human gates from the state machine (`humanGate: true`) block autonomous sessions and notify.
- A notification channel (stdout log, optional webhook) alerts when human attention is needed.

Acceptance criteria:
- [ ] `octowiz pause` prevents new dispatches across all sessions
- [ ] `octowiz resume` re-enables dispatch
- [ ] Human-gated transitions block autonomous sessions with a clear message
- [ ] `redirect` changes a session's next action
- [ ] Notification fires when an autonomous session hits a human gate

---

## Dependency Graph

```
Session 3.1 ─→ Session 3.2 ─→ Session 3.3 ─→ Session 3.4
                                     ↓
Session 4.1 ─→ Session 4.2 ─→ Session 4.3
     ↓              ↓
Session 4.4 ─→ Session 4.5 (depends on 3.3 + 4.2)
                    ↓
Session 5.1 ─→ Session 5.2 ─→ Session 5.3
     ↓                              ↓
Session 5.4                    Session 5.5 ─→ Session 5.6
```

**Parallelizable:**
- 3.1 and 4.1 can start in parallel (no code dependency)
- 5.4 (signed evidence) is independent of 5.2/5.3
- 4.3 (stubs) can run in parallel with 4.4

**Hard dependencies:**
- 3.3 requires 3.1 + 3.2 (wires resolution into state)
- 4.5 requires 3.3 (state next → runtime) and 4.2 (Claude Code adapter exists)
- All of Stage 5 requires 4.2 (runtime adapters exist for multi-session coordination)

---

## Session Checklist (for each session)

1. Create branch from `main`
2. Read this plan + the relevant existing code
3. Implement deliverables with tests
4. Run `pnpm test` — all tests pass
5. Run `pnpm lint` — no new violations
6. Commit with conventional commit message: `feat(capability): ...` / `feat(runtime): ...` / `feat(multiplayer): ...`
7. Push and create PR with summary of changes and which acceptance criteria are met
8. Merge after review (or self-merge for solo work)

---

## Risk Mitigation

| Risk | Mitigation |
|---|---|
| Registry becomes over-engineered | Start with static JSON; dynamic registration is Stage 4+ |
| Runtime abstraction breaks existing hooks | Session 4.2 is explicitly a refactor with zero behavioral change |
| Multiplayer conflicts are too complex | Advisory mode first; strict mode is opt-in |
| Worktree proliferation | Stale cleanup + human gate before deletion |
| Evidence signing adds crypto complexity | HMAC-SHA256 only; no PKI until remote trust is needed |
| Sessions depend on each other | Hard deps are explicit; parallelizable work is marked |

---

## Definition of Done (all stages)

Stage 3 is done when:
- `octowiz state next --json` returns a resolved capability with provider and command
- No hardcoded skill name remains in `src/state/` or the workflow skill routing logic
- Repository-local overrides work without modifying the default registry

Stage 4 is done when:
- The daemon and hooks operate through the adapter interface
- A new runtime can be added by implementing the interface + registering
- Runtime preference is configurable per repository

Stage 5 is done when:
- Two sessions can work on the same repo without silent conflicts
- Evidence is tied to a specific commit and session
- Human steering can pause/redirect autonomous sessions
- Worktree isolation provides a zero-conflict path for parallel autonomous work
