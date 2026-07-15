<div align="center">

<img src="assets/octowiz.jpeg" alt="Octowiz" width="720">

# Octowiz v1.1

**A local engineering control plane for AI-assisted software development.**

</div>

Octowiz connects Claude Code, AELLI, LiteLLM memory, repository state, and optional execution runtimes. It observes the current engineering situation, recommends the next useful phase, assembles context, and routes work through a Matt Pocock-first workflow.

Octowiz is not an autonomous IDE and not another general-purpose coding agent. It is the coordination layer around coding agents.

## Design principles

- **Matt Pocock first:** `mattpocock-skills` is the primary methodology pack.
- **No Superpowers dependency:** Superpowers is not installed, invoked, or required.
- **Repository-aware optional skills:** Antfu Skills are suggested only for relevant Vue, Nuxt, Vite, Vitest, pnpm, UnoCSS, or VueUse repositories.
- **Non-invasive by default:** no launchd or systemd service is installed automatically.
- **Fail open:** advisory and routing failures must not block the developer.
- **Evidence before completion:** tests, checks, acceptance criteria, and the actual diff define done.
- **Human gates for product decisions:** agents may execute scoped work, but unresolved intent and irreversible decisions remain human-controlled.

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

Octowiz owns scope, branch/worktree operations, execution supervision, and verification. Matt Pocock Skills provide TDD, diagnosis, and prototyping methodology.

### D. Review and handoff

Review the implementation against its requirements and wider architecture, run the verification gate, then produce a compact handoff or prepare a pull request.

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

## Status

`1.1.0-alpha.1` is an architectural reset. The core direction is stable, while lifecycle hardening, provider abstraction, state-machine routing, and cross-runtime support remain active development areas.
