<div align="center">

<img src="assets/octowiz.jpeg" alt="Octowiz" width="720">

# Octowiz v1.1

**A local engineering control plane for AI-assisted software development.**

</div>

Octowiz connects Claude Code, AELLI, LiteLLM memory, repository state, and optional execution runtimes. It observes the current engineering situation, recommends the next useful phase, assembles context, and routes work through a Matt Pocock-first workflow.

Octowiz is not an autonomous IDE and not another general-purpose coding agent. It is the coordination layer around coding agents.

## Design principles

- **Matt Pocock first:** `mattpocock-skills` is the primary methodology pack.
- **Lean by design:** choose the smallest maintainable solution that fully satisfies accepted scope.
- **No Superpowers dependency:** Superpowers is not installed, invoked, or required.
- **Repository-aware optional skills:** Antfu Skills are suggested only for relevant Vue, Nuxt, Vite, Vitest, pnpm, UnoCSS, or VueUse repositories.
- **Non-invasive by default:** no launchd or systemd service is installed automatically.
- **Fail open:** advisory and routing failures must not block the developer.
- **Evidence before completion:** tests, checks, acceptance criteria, and the actual diff define done.
- **Human gates for product decisions:** agents may execute scoped work, but unresolved intent and irreversible decisions remain human-controlled.
- **Persistent state over conversational reconstruction:** decisions, criteria, evidence, and transitions should survive sessions.

## Development phases

Octowiz keeps four understandable entry points while using repository evidence to recommend the shortest valid path.

### A. Idea and definition

Typical capabilities:

```text
mattpocock-skills:grill-me
mattpocock-skills:grill-with-docs
mattpocock-skills:prototype
mattpocock-skills:to-prd
mattpocock-skills:to-issues
mattpocock-skills:triage
```

### B. Plan validation

Challenge an existing plan against repository context, architecture, assumptions, acceptance criteria, and reversibility before implementation begins.

### C. Implementation and diagnosis

Octowiz owns scope, branch/worktree operations, execution supervision, the lean engineering gate, and verification. Matt Pocock Skills provide TDD, diagnosis, and prototyping methodology.

The lean gate evaluates, in order: do nothing, reuse repository capability, standard library, native platform, installed dependency, smaller design, then minimum complete implementation. It never overrides correctness, security, accessibility, accepted behavior, or required evidence.

### D. Review and handoff

Review the implementation against its requirements and wider architecture, run a dedicated complexity-reduction pass, execute the verification gate, then produce a compact handoff or prepare a pull request.

## Local runtime

The default runtime is an **ephemeral local supervisor**.

```text
Claude Code SessionStart
        ↓
hooks/scripts/local.js ensure
        ↓
Octowiz local supervisor
        ├─ task queue subscription
        ├─ Python A2A child when needed
        └─ session leases

Claude Code SessionEnd
        ↓
hooks/scripts/local.js release
        ↓
idle timeout
        ↓
clean shutdown
```

The supervisor:

- runs as the current user;
- binds only to `127.0.0.1` by default;
- starts only when a session needs it;
- leaves foreign services on occupied ports untouched;
- expires stale session leases;
- exits after an idle grace period;
- writes no launchd or systemd configuration.

Health endpoint:

```bash
curl -s http://127.0.0.1:${OCTOWIZ_LOCAL_PORT:-8764}/health
```

Configuration:

```text
OCTOWIZ_LOCAL_PORT=8764
OCTOWIZ_A2A_PORT=8765
OCTOWIZ_IDLE_TIMEOUT_MS=600000
OCTOWIZ_LEASE_TTL_MS=1800000
```

Persistent operating-system services may be offered later through an explicit opt-in command. They are not part of the default installation.

## Hooks

| Event | Purpose |
|---|---|
| `SessionStart` | ensure local supervisor, register lease, capture repository context |
| `UserPromptSubmit` | forward intent and current modified files to AELLI |
| `PostToolUse` | forward file-edit observations |
| `SessionEnd` | send session-end and release the local lease |

Hooks never install packages, register OS services, or mutate system configuration.

## Skill dependencies

Required:

```text
mattpocock-skills
```

Optional when repository evidence supports them:

```text
antfu-skills
```

Explicitly unsupported as an Octowiz dependency:

```text
superpowers
```

The Octowiz skill also contains a native lean engineering gate conceptually adapted from [Ponytail](https://github.com/TheYan3/ponytail-skills) by Yannic Jundt under the MIT License. Octowiz uses it as an evidence-backed implementation and review control, not as a replacement for normal engineering review.

## Architecture

```text
Developer / Claude Code
          │ hooks and workflow invocation
          ▼
Octowiz Bridge + Ephemeral Supervisor
          │
          ├─ repository and session context
          ├─ workflow phase recommendation
          ├─ task queue consumer
          ├─ verification and policy boundaries
          └─ local A2A endpoint
          │
          ▼
LiteLLM / AELLI
          ├─ routing
          ├─ memory doctrine
          ├─ dev advisor
          └─ remote task coordination
```

The Node layer owns trusted local policy and queue handling. The Python A2A application exposes richer agent capabilities. AELLI remains the intelligence and orchestration plane, while Octowiz is its engineering tentacle on the developer machine.

## Persistent engineering state

Octowiz keeps a durable, machine-independent record of what a repository's engineering work is actually doing — goal, internal workflow state, decisions, open questions, acceptance criteria, lean-gate outcome, and verification evidence. It survives session termination and is the shared operational truth for humans, coding agents, and (later) AELLI.

> The state model is the product. Skills, agents, hooks, and runtimes are adapters around it.

### Two stores, one hard boundary

| | Repository state | Machine runtime state |
|---|---|---|
| Location | `.octowiz/state.json` + `.octowiz/events.jsonl` | `~/.cache/octowiz/<repository-id>/runtime.json` |
| Content | goal, state, decisions, criteria, lean gate, evidence, revision | sessions, PIDs, leases, heartbeats, local paths |
| Committed | may be committed (default: yes) | never — lives outside the repository |
| Written by | the `octowiz state` CLI only | session hooks |

Repository state must never contain secrets, tokens, PIDs, ports, session IDs, or machine-local absolute paths — every write is validated against these rules and rejected on violation. `OCTOWIZ_RUNTIME_DIR` overrides the runtime location.

### CLI

```bash
octowiz state init                                  # create .octowiz/state.json + first ledger event
octowiz state show [--json]                         # current state (all commands support --json)
octowiz state validate                              # schema + ledger check
octowiz state set-goal "persistent state"
octowiz state link-artifact --type issue --id issue-42
octowiz state ask "commit the ledger by default?"   # open a (blocking) question
octowiz state decide "state.json is canonical"      # record an accepted decision
octowiz state add-criterion "state survives sessions"
octowiz state criterion <id> --status passed --evidence "jest suite"
octowiz state lean --rung reuse-existing-code --decision "..." --reject "..."
octowiz state evidence tests passed --ref "jest: 23 suites"
octowiz state transition implement [--expected-revision 12]
octowiz state next                                  # deterministic next-action recommendation
octowiz state history [--limit 20]                  # ledger events
octowiz state repair                                # backup-first recovery of a broken state file
```

Agents mutate state through these commands, never by editing `state.json` directly.

### Internal state machine

A/B/C/D stays the human-facing vocabulary. Internally, work moves through explicit, guarded transitions:

```text
explore -> define -> plan -> implement -> verify -> review -> ready-to-ship -> shipped
                                 ^  \                    /
                                 |   \-> diagnose ------/   (verify/review can return to implement)
any active state <-> blocked (returns only to where it was)
```

Guards fail closed with the exact unmet preconditions: `plan -> implement` needs a goal, an artifact (or explicit waiver), a criterion, and no blocking questions; `verify -> review` needs tests/lint/types passed or waived with a reason; `ready-to-ship -> shipped` needs completion evidence. Every waiver requires a reason.

### Storage guarantees

- **Atomic writes** — the snapshot is only ever replaced by temp-file + rename; partial JSON cannot reach `state.json`.
- **Optimistic concurrency** — every mutation increments `revision`; `--expected-revision` turns stale writes into explicit conflicts instead of silent overwrites.
- **Append-only ledger** — every successful mutation appends one compact event to `events.jsonl`; a failed append rolls the snapshot back so the two never diverge. `state.json` is the canonical snapshot; the ledger is audit and future reconstruction.
- **Corruption safety** — a broken file is reported with its exact path and preserved, never rebuilt silently; `octowiz state repair` backs it up first, then recreates a valid state continuing the ledger's revision sequence.
- **No downgrades** — a state file from a newer schema version is refused, not rewritten.

### Git behavior

`state.json` and `events.jsonl` may be committed (this repository's `.gitignore` un-ignores exactly those two files; everything else under `.octowiz/` — locks, temp files, repair backups — stays ignored). The CLI warns if a machine-local `runtime.json` ever appears inside the repository. Octowiz does not modify `.gitignore` on its own.

### Known limitations

- The ledger is not yet replayable into a full snapshot; repair produces a fresh valid state, not a reconstruction.
- The activity guard for `implement -> verify` observes working-tree changes; fully committed work needs `--waive-activity-check --reason`.
- Locking is per-machine (lock file + revision checks); cross-machine coordination is out of scope until remote synchronization exists.
- AELLI synchronization is deliberately postponed: the local single-repository model must prove itself before a remote projection layer earns its complexity. Remote proposals must never silently rewrite local evidence.

The full model — domain boundaries, transition contract, event model, privacy rules, delivery milestones — lives in [`docs/engineering-state-model.md`](docs/engineering-state-model.md).

## Setup

1. Install the Octowiz plugin.
2. Install `mattpocock-skills`.
3. Configure the required AELLI and LiteLLM endpoints and credentials for your deployment.
4. Run the Matt Pocock repository setup when an agent instruction file exists.
5. Open a Claude Code session. The ephemeral supervisor starts automatically.

Antfu Skills are optional. Their absence must never block setup.

## Development

Requirements:

- Node.js 22.13 or newer
- pnpm 10
- Python 3.8 or newer for the A2A application and memory CLI

```bash
pnpm install
pnpm test
pnpm lint
```

Python tests:

```bash
python -m pytest
```

## Security posture

- Local HTTP listeners bind to loopback by default.
- Repository paths are validated before remote execution.
- Queue tasks require claims and lease tokens.
- Unknown capabilities are rejected.
- Sensitive header values are sanitized.
- Hook failures are fail-open for the developer experience.
- Octowiz does not kill a process unless it can identify it as its own.
- Remote state updates are proposals until validated against trusted local facts.
- Persistent state must never contain credentials or secret headers.

## Status

`1.1.0-alpha.1` is an architectural reset. The core direction is stable. The next milestone is the persistent engineering-state model, followed by capability resolution, runtime abstraction, and multiplayer execution.