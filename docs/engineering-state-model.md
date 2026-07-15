# Octowiz Persistent Engineering State

## Status

Proposed next architectural milestone after the v1.1 runtime reset.

The next major step for Octowiz is not another agent, skill pack, or routing layer. It is a durable engineering-state model that survives sessions and gives every human or agent the same operational truth.

## Purpose

The state model must let Octowiz answer six questions without reconstructing the project from chat history:

1. What outcome are we pursuing?
2. What is currently true about the repository?
3. Which decisions have already been made?
4. What is the safest useful next action?
5. What evidence exists for completion?
6. How can another session, runtime, or developer continue?

A/B/C/D remains the human-facing workflow. Internally, Octowiz should operate on explicit state and evidence.

## Canonical example

```json
{
  "schemaVersion": "0.1",
  "repository": {
    "id": "github:raelli/octowiz-v1.1",
    "root": "/workspace/octowiz-v1.1",
    "branch": "feat/ephemeral-matt-first-reinvention",
    "head": "b15ebd9"
  },
  "phase": "implementation",
  "goal": "ephemeral local supervisor",
  "artifact": {
    "type": "issue",
    "id": "issue-42",
    "url": null
  },
  "status": "active",
  "decisions": [
    {
      "id": "decision-001",
      "statement": "no automatic OS service",
      "reason": "developer trust and non-invasive installation",
      "status": "accepted",
      "reversible": true,
      "recordedAt": "2026-07-16T00:00:00Z"
    }
  ],
  "openQuestions": [],
  "acceptanceCriteria": [
    {
      "id": "ac-session-leases",
      "statement": "session leases are registered and released",
      "status": "passed",
      "evidenceRefs": ["evidence-test-node-22"]
    },
    {
      "id": "ac-idle-shutdown",
      "statement": "supervisor exits after the configured idle period",
      "status": "passed",
      "evidenceRefs": ["evidence-test-node-24"]
    },
    {
      "id": "ac-foreign-port",
      "statement": "foreign services on the control port are never stopped",
      "status": "passed",
      "evidenceRefs": ["evidence-test-foreign-port"]
    }
  ],
  "leanGate": {
    "status": "passed",
    "selectedRung": "native-user-process",
    "rejectedAlternatives": ["launchd", "systemd", "second daemon manager"],
    "complexityDelta": {
      "estimatedLines": -180,
      "conceptsRemoved": 3
    }
  },
  "evidence": {
    "tests": {
      "status": "passed",
      "items": ["evidence-test-node-22", "evidence-test-node-24", "evidence-test-python"]
    },
    "lint": {
      "status": "passed",
      "items": ["evidence-eslint"]
    },
    "review": {
      "status": "pending",
      "items": []
    }
  },
  "nextAction": {
    "capability": "architecture-review",
    "reason": "implementation and automated verification are complete",
    "humanGate": false
  },
  "sessions": [
    {
      "id": "cc-123",
      "runtime": "claude-code",
      "actor": "human-assisted-agent",
      "startedAt": "2026-07-16T00:00:00Z",
      "lastSeenAt": "2026-07-16T00:20:00Z",
      "status": "active"
    }
  ],
  "updatedAt": "2026-07-16T00:20:00Z",
  "revision": 12
}
```

## Domain boundaries

### Repository state

Facts derived from Git and the filesystem:

- repository identity and root
- branch, head, dirty state, worktree
- active pull request or issue
- modified files
- detected stack and configured checks

Repository facts are observed. Agents do not invent them.

### Intent state

Human-approved product and engineering intent:

- goal
- artifact or issue
- accepted scope
- decisions
- open questions
- acceptance criteria

Material intent changes require a human gate unless an existing policy explicitly permits them.

### Execution state

What is happening now:

- current internal state and human-facing phase
- active session and runtime
- claimed task or lease
- current branch or worktree
- next intended capability
- blockers and retry state

### Evidence state

Machine-readable proof:

- test command, exit status, timestamp, commit SHA
- lint and type-check results
- review findings and resolution status
- acceptance-criterion mapping
- generated artifacts or PR URLs

A completion claim without evidence remains `pending` or `unverified`.

## Human-facing phases and internal states

A/B/C/D should remain the simple entry surface:

| Human phase | Typical internal states |
|---|---|
| A. Idea and definition | `explore`, `define`, `prototype` |
| B. Plan validation | `design`, `challenge`, `slice`, `ready` |
| C. Implementation and diagnosis | `implement`, `diagnose`, `blocked` |
| D. Review and handoff | `verify`, `review`, `ship`, `handoff` |

Example transition graph:

```text
explore -> define -> design -> slice -> ready -> implement -> verify -> review -> ship
                                      \-> diagnose -> implement
                                      \-> blocked -> human-decision
```

Transitions must be evidence-backed. Opening a PR does not automatically mean `review`; passing tests does not automatically mean `ship`.

## Transition contract

Every transition should record:

```json
{
  "from": "implement",
  "to": "verify",
  "trigger": "implementation-complete",
  "preconditions": [
    "accepted scope exists",
    "working tree changes are attributable to the task"
  ],
  "evidence": [
    "diff captured",
    "acceptance criteria mapped"
  ],
  "actor": "octowiz",
  "timestamp": "2026-07-16T00:20:00Z"
}
```

Invalid transitions should fail closed for autonomous execution but remain explainable to the developer.

## Storage strategy

### Recommended first implementation

Use one repository-local state file as the canonical local truth:

```text
.octowiz/state.json
```

Use an append-only event ledger beside it:

```text
.octowiz/events.jsonl
```

The snapshot supports fast reads. The event ledger supports debugging, replay, audit, and recovery.

Recommended defaults:

- `.octowiz/state.json` is machine-managed.
- `.octowiz/events.jsonl` is machine-managed and may be compacted.
- secrets are never stored.
- absolute paths are local-only fields and must be removed from remote synchronization.
- teams may choose whether state is committed, ignored, or split into public and private portions.

### Later synchronization

AELLI may receive a sanitized projection through LiteLLM Memory, PostgreSQL, or an A2A state service. The local state remains authoritative for repository and execution facts. Remote intelligence may propose updates but must not silently rewrite trusted local evidence.

## Concurrency model

Use optimistic concurrency through `revision` and atomic file replacement.

Write contract:

1. read current state and revision
2. produce a validated transition
3. write a temporary file
4. atomically rename it to `state.json`
5. append the transition event
6. reject stale writes whose expected revision no longer matches

For multiple simultaneous sessions, add short-lived state leases per task or worktree. Do not rely on one global process lock for semantic ownership.

## Event model

Minimum event types:

```text
session.started
session.ended
intent.goal-set
decision.recorded
decision.superseded
criterion.added
criterion.updated
phase.transitioned
task.claimed
task.released
repository.observed
lean-gate.completed
verification.started
verification.completed
review.finding-added
review.finding-resolved
handoff.created
```

Events should include schema version, repository ID, session ID, actor, timestamp, and causation ID.

## Integration with the Lean Engineering Gate

The Ponytail-derived gate becomes a state transition guard before implementation and a review pass before shipping.

Before `ready -> implement`:

- record which rung satisfied the requirement
- record rejected complexity
- record known ceilings and upgrade conditions

Before `review -> ship`:

- run the complexity-reduction pass
- resolve or explicitly defer concrete findings
- record estimated concept and line reduction

The lean gate never overrides security, correctness, accessibility, accepted behavior, or evidence requirements.

## Integration with Skills and capability routing

Skills should consume and update state through capabilities rather than owning the lifecycle.

Examples:

- `grill-me` updates open questions and decisions
- `to-prd` attaches or creates the primary artifact
- `to-issues` creates vertical slices and dependencies
- `tdd` supplies implementation methodology
- `diagnose` records hypotheses, observations, and resolved root cause
- `zoom-out` creates architecture findings
- `handoff` renders a compact projection of current state

Octowiz owns state validation, transition policy, persistence, evidence, and lifecycle routing.

## CLI target

A future deterministic CLI should expose:

```bash
octowiz state show
octowiz state init
octowiz state transition implement
octowiz state decide "no automatic OS service"
octowiz state criterion add "foreign port safety"
octowiz state evidence record --kind test --command "pnpm test" --exit-code 0
octowiz state next
octowiz state handoff
octowiz state validate
```

Structured JSON output should be available for agents:

```bash
octowiz state show --json
```

## Validation invariants

At minimum:

- `schemaVersion`, repository identity, phase, status, revision, and timestamps are required.
- accepted decisions are immutable; replacements create a superseding decision.
- passed criteria require evidence references.
- `ship` requires all required criteria passed and the verification gate satisfied.
- one task cannot be actively owned by two incompatible sessions.
- remote projections cannot mark local commands as passed without local evidence.
- stale commits invalidate evidence unless the check declares its valid scope.
- transitions must be append-only in the event ledger.

## Privacy and security

Never store:

- API keys, tokens, credentials, or secret headers
- complete prompts when a short intent summary is sufficient
- sensitive source contents in remote projections
- unredacted developer home paths in synchronized state

Treat state updates from remote services as untrusted proposals until validated locally.

## Delivery sequence

### Milestone 1: Schema and local store

- define JSON Schema
- implement atomic read/write
- implement revision checks
- create snapshot and event ledger
- support init, show, validate, and transition

### Milestone 2: Hook integration

- create or resume state on `SessionStart`
- record repository observations
- close session lease on `SessionEnd`
- keep hooks fail-open while logging invalid state

### Milestone 3: Workflow integration

- route A/B/C/D from state
- integrate lean gate
- map acceptance criteria to evidence
- render deterministic handoff

### Milestone 4: Remote projection

- sanitize and synchronize selected fields to AELLI
- support cross-session and cross-machine resume
- implement conflict detection and reconciliation

### Milestone 5: Multiplayer execution

- task and worktree ownership
- concurrent session leases
- conflict warnings
- signed evidence bundles

## Definition of done for the first release

The first engineering-state release is complete when:

- a new repository can initialize a valid state document
- a second Claude Code session can resume without reconstructing intent manually
- decisions and acceptance criteria survive process shutdown
- tests and lint results are tied to a commit and criterion
- stale concurrent writes are rejected
- state can generate a concise human handoff
- no OS service, database, or cloud dependency is required

This model is the foundation for runtime independence, multiplayer work, reliable autonomous execution, and genuine cross-session continuity.