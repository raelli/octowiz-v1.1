<div align="center">

<img src="assets/octowiz.jpeg" alt="Octowiz" width="720">

# Octowiz v1.1

**A local engineering control plane for AI-assisted software development.**

</div>

Octowiz coordinates Claude Code, AELLI, durable repository state, skill resolution, and execution runtimes. It observes the current engineering situation, recommends the next useful capability, assembles context, and routes work through a Matt Pocock-first workflow.

Octowiz is not an autonomous IDE and not another general-purpose coding agent. It is the coordination and policy layer around coding agents.

> **Release status:** `1.1.0-alpha.1`. The Claude Code path, persistent state, capability resolution, and runtime selection are implemented. OpenCode and Daytona are currently adapter stubs, and the Stage 5 multiplayer modules are not yet wired into one end-to-end operator flow.

## Current implementation status

| Area | Status | What that means today |
|---|---|---|
| Claude Code hooks | Integrated | Session lifecycle, prompt, and file-edit events are captured through the plugin hooks. |
| Ephemeral local supervisor | Integrated | Starts on demand, binds to loopback, tracks session leases, and exits after idle timeout. |
| Local Python A2A agent | Integrated | Started by the supervisor when dependencies and security configuration are present. |
| AELLI and task-queue forwarding | Integrated, configuration-dependent | Delivery is active when the required AELLI endpoints and credentials are configured. |
| Persistent engineering state | Integrated | Versioned state, guarded transitions, append-only ledger, repair, and deterministic next-action CLI. |
| Capability resolution | Integrated | Abstract capabilities resolve to repository-appropriate providers and commands. |
| Runtime abstraction | Integrated | Runtime registry, availability checks, repository-local preference, and normalized events exist. |
| Claude Code runtime adapter | Operational | Default advisory runtime around the existing supervisor and hook flow. |
| OpenCode runtime adapter | Stub | Availability probe works; task dispatch returns `deferred`. |
| Daytona runtime adapter | Stub | API health probe works; task dispatch returns `deferred`. |
| Multiplayer and autonomous-execution modules | Implemented building blocks | Sessions, ownership, worktrees, conflicts, evidence bundles, leases, and steering exist as modules, but are not yet exposed as a unified CLI and hook-driven workflow. |
| Remote AELLI state synchronization | Planned | Local repository state remains authoritative; remote updates must eventually arrive as validated proposals. |

## Design principles

- **Matt Pocock first:** `mattpocock-skills` is the primary methodology pack.
- **Lean by design:** choose the smallest maintainable solution that fully satisfies accepted scope.
- **No Superpowers dependency:** Superpowers is not installed, invoked, or required.
- **Repository-aware optional skills:** Antfu Skills are suggested only for relevant Vue, Nuxt, Vite, Vitest, pnpm, UnoCSS, or VueUse repositories.
- **Non-invasive by default:** no launchd or systemd service is installed automatically.
- **Fail open for the developer:** advisory and routing failures must not block local development.
- **Fail closed at security and state boundaries:** invalid paths, malformed state, unsafe transitions, and unknown capabilities are rejected.
- **Evidence before completion:** tests, checks, acceptance criteria, and the actual diff define done.
- **Human gates for product decisions:** unresolved intent and irreversible decisions remain human-controlled.
- **Persistent state over conversational reconstruction:** decisions, criteria, evidence, and transitions survive sessions.

## Development phases

Octowiz keeps four human-readable entry points while using repository evidence to recommend the shortest valid path.

### A. Idea and definition

Explore the goal, challenge assumptions, resolve ambiguity, define scope, and create acceptance criteria before implementation begins. Depending on repository context, capability resolution can route this work to requirements discovery, PRD creation, issue creation, or a human decision.

### B. Plan validation

Challenge an existing plan against repository context, architecture, assumptions, acceptance criteria, and reversibility before implementation begins.

### C. Implementation and diagnosis

Octowiz owns scope, state transitions, execution policy, the lean engineering gate, and verification evidence. Matt Pocock Skills provide TDD, diagnosis, and prototyping methodology.

The lean gate evaluates, in order: do nothing, reuse repository capability, standard library, native platform, installed dependency, smaller design, then minimum complete implementation. It never overrides correctness, security, accessibility, accepted behavior, or required evidence.

### D. Review and handoff

Review the implementation against its requirements and wider architecture, run a dedicated complexity-reduction pass, execute the verification gate, then produce a compact handoff or prepare a pull request.

## Architecture

```text
Developer / Claude Code
          │
          ├─ plugin hooks
          ├─ Octowiz CLI
          └─ repository facts
          │
          ▼
Octowiz control plane
          ├─ persistent engineering state
          ├─ deterministic next-action resolver
          ├─ capability registry
          ├─ runtime registry and selection
          ├─ normalized event protocol
          ├─ trusted path and policy checks
          └─ ephemeral local supervisor
          │
          ├───────────────┬────────────────┐
          ▼               ▼                ▼
 Claude Code        OpenCode stub      Daytona stub
 operational         deferred            deferred
          │
          ▼
Local A2A agent and queue bridge
          │
          ▼
LiteLLM / AELLI
          ├─ model and agent routing
          ├─ memory doctrine
          ├─ development advisor
          └─ remote task coordination
```

The Node layer owns trusted local policy, state, capability resolution, runtime selection, and queue handling. The Python A2A application exposes richer agent capabilities. AELLI remains the intelligence and orchestration plane, while Octowiz is its engineering control surface on the developer machine.

## Local runtime lifecycle

The default runtime is an **ephemeral local supervisor**.

```text
Claude Code SessionStart
        ↓
hooks/scripts/local.js ensure
        ↓
Octowiz local supervisor
        ├─ task queue consumer
        ├─ Python A2A child when available
        ├─ session leases
        └─ loopback health endpoint

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
- requires an explicit repository allowlist;
- leaves foreign services on occupied ports untouched;
- verifies an existing A2A listener before reusing it;
- expires stale session leases;
- exits after an idle grace period;
- writes no launchd or systemd configuration.

Health endpoint:

```bash
curl -s http://127.0.0.1:${OCTOWIZ_LOCAL_PORT:-8764}/health
```

## Requirements

- Node.js `22.13` or newer
- pnpm `10`
- Python `3.8` or newer
- `mattpocock-skills`
- Git for repository inspection and worktree operations

The local A2A server additionally needs FastAPI and Uvicorn from `apps/a2a-agent/requirements.txt`.

## Setup

### 1. Install project dependencies

```bash
corepack enable
pnpm install --frozen-lockfile
python3 -m pip install -e ".[dev]"
python3 -m pip install -r apps/a2a-agent/requirements.txt
```

### 2. Install the required workflow pack

```bash
claude plugins install mattpocock-skills
```

Antfu Skills are optional. Their absence must never block setup.

### 3. Configure the security boundary

`OCTOWIZ_ALLOWED_ROOTS` is required. An empty value is deny-all and prevents the local supervisor from starting.

```bash
export OCTOWIZ_ALLOWED_ROOTS="$HOME/Projects"
```

Multiple roots use the operating system path separator: `:` on macOS and Linux, `;` on Windows.

The protected local A2A endpoint also requires a shared secret for dispatch:

```bash
export OCTOWIZ_INBOUND_SECRET="replace-with-a-long-random-secret"
```

### 4. Configure AELLI delivery

Exact URLs depend on the deployment. A typical authenticated setup includes:

```bash
export AELLI_AUTH_TOKEN="replace-with-your-token"
export AELLI_BASE_URL="https://your-aelli-host.example"
```

When A2A traffic is routed through LiteLLM, configure `AELLI_LITELLM_BASE` as well. Do not print or commit tokens and secrets.

### 5. Install or load Octowiz as a Claude Code plugin

The plugin manifest is `.claude-plugin/plugin.json`. Install this repository through the Claude Code plugin workflow used by your environment, then open a Claude Code session in an allowed repository.

### 6. Initialize persistent state where needed

CLI examples below assume `octowiz` is installed or linked on `PATH`. From a checkout, replace `octowiz` with `node bin/octowiz.js`.

```bash
octowiz state init
octowiz state show
octowiz state next
```

## Hooks

| Event | Purpose |
|---|---|
| `SessionStart` | ensure local supervisor, register leases, load engineering state, capture repository context, and send session-start advisory data |
| `UserPromptSubmit` | forward intent and current repository context through the Claude Code bridge |
| `PostToolUse` | forward file-edit observations for supported edit tools |
| `SessionEnd` | send session-end, release state/runtime session data, and release the supervisor lease |

Hooks never install packages, register OS services, or mutate system configuration.

## CLI

### Persistent engineering state

```bash
octowiz state init
octowiz state show [--json]
octowiz state validate
octowiz state set-goal "persistent state"
octowiz state link-artifact --type issue --id issue-42
octowiz state ask "commit the ledger by default?"
octowiz state decide "state.json is canonical"
octowiz state add-criterion "state survives sessions"
octowiz state criterion <id> --status passed --evidence "jest suite"
octowiz state lean --rung reuse-existing-code --decision "..."
octowiz state evidence tests passed --ref "jest: suites passed"
octowiz state transition implement [--expected-revision 12]
octowiz state next
octowiz state history [--limit 20]
octowiz state repair
```

Agents mutate state through these commands, never by editing `state.json` directly.

### Capability resolution

```bash
octowiz capability list
octowiz capability resolve implementation
octowiz capability resolve code-review --json
```

The default registry lives at `skills/registry.json`. A repository may override or extend it with `.octowiz/capabilities.json`.

### Runtime selection

```bash
octowiz runtime list
octowiz runtime show
octowiz runtime select claude-code
octowiz runtime select opencode
octowiz runtime select daytona
```

The preference is stored in `.octowiz/config.json`. Selecting OpenCode or Daytona does not make those adapters operational yet. Their current dispatch result is `deferred`.

## Persistent engineering state

Octowiz keeps a durable, machine-independent record of what a repository's engineering work is doing: goal, internal workflow state, decisions, open questions, acceptance criteria, lean-gate outcome, and verification evidence.

> The state model is the product. Skills, agents, hooks, and runtimes are adapters around it.

### Two stores, one hard boundary

| | Repository state | Machine runtime state |
|---|---|---|
| Location | `.octowiz/state.json` and `.octowiz/events.jsonl` | `~/.cache/octowiz/<repository-id>/` by default |
| Content | goal, workflow state, decisions, criteria, lean gate, evidence, revision | sessions, PIDs, leases, heartbeats, local paths |
| Committed | may be committed | never |
| Written by | `octowiz state` CLI | hooks and runtime modules |

Repository state must never contain secrets, tokens, PIDs, ports, session IDs, or machine-local absolute paths. Every write is validated against these rules and rejected on violation. `OCTOWIZ_RUNTIME_DIR` overrides the machine-local runtime location.

### Internal state machine

A/B/C/D stays the human-facing vocabulary. Internally, work moves through explicit guarded transitions:

```text
explore -> define -> plan -> implement -> verify -> review -> ready-to-ship -> shipped
                                 ^  \                    /
                                 |   \-> diagnose ------/   verify/review can return to implement
any active state <-> blocked          blocked returns only to its previous state
```

Guards fail closed with exact unmet preconditions. Every waiver requires a reason.

### Storage guarantees

- **Atomic writes:** the snapshot is replaced by temp-file plus rename.
- **Optimistic concurrency:** every mutation increments `revision`; `--expected-revision` turns stale writes into explicit conflicts.
- **Append-only ledger:** every successful mutation appends a compact event; failed appends roll the snapshot back.
- **Corruption safety:** broken files are preserved and reported; repair creates a backup first.
- **No downgrades:** state from a newer schema version is refused rather than rewritten.

The full model lives in [`docs/engineering-state-model.md`](docs/engineering-state-model.md).

## Capability model

Octowiz routes abstract engineering capabilities instead of hardcoding one skill command into the state machine. The registry currently covers requirements discovery, definition, plan validation, decision resolution, lean design, implementation, diagnosis, verification, code review, handoff, and human decisions.

Resolution can use observable repository conditions such as documentation presence, tests, TypeScript, Python, pnpm workspaces, and the Vue/Nuxt/Vite ecosystem.

Required provider:

```text
mattpocock-skills
```

Optional provider when repository evidence supports it:

```text
antfu-skills
```

Built-in provider:

```text
octowiz-native
```

Explicitly unsupported as an Octowiz dependency:

```text
superpowers
```

The native lean engineering gate is conceptually adapted from [Ponytail](https://github.com/TheYan3/ponytail-skills) by Yannic Jundt under the MIT License.

## Runtime abstraction

All runtimes implement a shared adapter contract for availability, status, dispatch, and event notifications.

- **Claude Code:** operational default runtime. Dispatch is advisory and uses the existing supervisor, hook, and AELLI flow.
- **OpenCode:** TCP availability probe plus deferred dispatch stub. Default probe port is `9100` or `OPENCODE_PORT`.
- **Daytona:** HTTP health probe plus deferred dispatch stub. Default API URL is `http://localhost:3986` or `DAYTONA_API_URL`.

Normalized runtime events wrap session, prompt, tool, task, and state activity without discarding runtime-specific payloads.

## Multiplayer and autonomous-execution building blocks

Stage 5 added tested modules for:

- machine-local session ledgers and heartbeats;
- advisory or strict ownership claims;
- Git worktree creation and cleanup;
- overlapping-change and pre-merge conflict detection;
- optional HMAC-SHA256 evidence bundles tied to commits;
- renewable task leases;
- global pause/resume, redirect, and human-gate state.

These are currently library-level building blocks. The following planned operator commands are **not yet wired into `bin/octowiz.js`**:

```text
octowiz worktree ...
octowiz evidence ...
octowiz pause
octowiz resume
octowiz redirect ...
```

Do not treat Stage 5 as end-to-end multiplayer execution until these modules are integrated with hooks, the supervisor, runtime dispatch, and a stable CLI surface.

## Configuration reference

| Variable | Default | Purpose |
|---|---:|---|
| `OCTOWIZ_ALLOWED_ROOTS` | none, deny-all | Required allowlist for repository paths. Uses the OS path separator. |
| `OCTOWIZ_LOCAL_PORT` | `8764` | Local supervisor health and lease API. |
| `OCTOWIZ_A2A_PORT` | `8765` | Local Python A2A listener. |
| `OCTOWIZ_A2A_URL` | local port-derived URL | Explicit A2A server URL. |
| `OCTOWIZ_INBOUND_SECRET` | none | Shared secret for protected local A2A requests. |
| `OCTOWIZ_IDLE_TIMEOUT_MS` | `600000` | Supervisor idle shutdown delay. |
| `OCTOWIZ_LEASE_TTL_MS` | `1800000` | Ephemeral supervisor lease expiry. |
| `OCTOWIZ_RUNTIME_DIR` | `~/.cache/octowiz` | Machine-local state override. |
| `OCTOWIZ_DISPATCH_TIMEOUT` | `600` seconds | Python dispatch ceiling. |
| `AELLI_BASE_URL` | local development defaults | Base URL for AELLI services. |
| `AELLI_LITELLM_BASE` | none | LiteLLM A2A gateway base. |
| `AELLI_AUTH_TOKEN` | none | Authentication token and canonical AELLI credential. |
| `AELLI_CACHE_DIR` | `~/.cache/aelli-cc` | Supervisor logs and compatibility cache. |
| `OPENCODE_PORT` | `9100` | OpenCode stub availability probe. |
| `DAYTONA_API_URL` | `http://localhost:3986` | Daytona stub health probe. |

## Development and verification

```bash
pnpm lint
pnpm test
python -m pytest packages/memory_client/tests apps/claude_code_bridge/tests providers/tests
```

CI runs ESLint, JavaScript syntax checks, Jest on Node.js 22 and 24, and Python tests on Python 3.12.

## Security posture

- Local HTTP listeners bind to loopback by default.
- Repository paths are realpath-resolved and checked against `OCTOWIZ_ALLOWED_ROOTS` before downstream execution.
- Empty path configuration is deny-all.
- Queue tasks require claims and lease tokens.
- Unknown capabilities are rejected.
- Sensitive header values are sanitized.
- Hook failures are fail-open for developer experience.
- Octowiz does not stop a process unless it can identify it as its own.
- Existing A2A listeners are classified before reuse.
- Remote state updates remain proposals until validated against trusted local facts.
- Persistent repository state must never contain credentials or secret headers.

## Known limitations and next integration work

- OpenCode and Daytona cannot execute tasks yet; both adapters return `deferred`.
- Runtime preference is managed separately from the deterministic state recommendation and still needs full dispatch integration.
- Stage 5 modules are not yet connected into one hook-driven, CLI-controlled multiplayer workflow.
- The event ledger is not yet replayable into a full snapshot; repair creates a fresh valid state instead of reconstructing history.
- Locking and multiplayer state are machine-local; cross-machine coordination is out of scope until remote synchronization exists.
- AELLI synchronization is deliberately postponed until the local single-repository model proves stable.

The next valuable milestone is integration, not another abstraction layer: wire runtime choice into dispatch, connect multiplayer primitives to lifecycle events and CLI commands, and then implement real OpenCode and Daytona execution adapters.
