# Octowiz v1.1 Product and Architecture Review

## Executive assessment

Octowiz is a credible and unusually well-directed attempt to solve a real gap in AI-assisted software development: coding agents have become capable, but their surrounding workflow is fragmented, session-bound, context-hungry, and weakly governed.

The strongest idea is not the individual hook, skill, daemon, or A2A endpoint. It is the product boundary:

> Octowiz is an engineering control plane around coding agents, while AELLI remains the intelligence and orchestration plane.

That is a useful distinction. It gives Octowiz a defensible purpose beyond being another coding assistant.

Current verdict:

- **Product direction:** strong
- **Technical originality:** meaningful combination of existing primitives
- **Implementation maturity:** promising alpha with architectural debt
- **Potential:** high for internal engineering teams and agentic development platforms
- **Primary risk:** trying to become workflow engine, local agent, memory client, plugin marketplace, policy layer, and UI at the same time

## What genuinely works

### 1. The engineering-control-plane framing

Most coding-agent tools optimize the model interaction. Octowiz instead focuses on everything around it:

- lifecycle routing
- repository evidence
- memory doctrine
- session continuity
- policy boundaries
- execution supervision
- verification
- handoff
- coordination with a remote intelligence plane

This is the project's most important asset. Preserve it.

### 2. Separation between AELLI and Octowiz

The architecture becomes coherent when the responsibilities are explicit:

- **AELLI:** intelligence, routing, memory, cross-agent coordination
- **Octowiz:** local engineering context, trusted policy, runtime bridge, execution evidence
- **Coding runtime:** Claude Code today, potentially OpenCode and others later
- **Sandbox:** Daytona or another isolated execution environment when needed

This separation is stronger than embedding all intelligence directly into a Claude Code plugin.

### 3. Evidence-aware workflow routing

A/B/C/D is understandable to humans. The direction toward inferring a phase from repository and session evidence is the innovative part.

A useful router can consider:

- user intent
- branch and dirty state
- existing PRD or issues
- unresolved decisions
- failing tests
- active pull request
- architecture impact
- reversibility
- previous session state

This can become more valuable than any single skill integration.

### 4. Fail-open local integration

Hooks should not interrupt normal development when AELLI, LiteLLM, or an advisory endpoint is unavailable. The existing fail-open stance is correct for adoption and developer trust.

### 5. Security boundaries already exist

The repository contains several signs of serious engineering rather than prompt-only experimentation:

- allowed-root validation
- queue claims and leases
- capability allowlists
- control-character sanitization
- localhost defaults
- refusal to kill unidentified processes
- separation between local and remote auth headers

These are important foundations for a product that may eventually execute work autonomously.

## How innovative is it?

Octowiz is not based on a single unprecedented technical primitive. Hooks, A2A, memory stores, task queues, skills, sandboxes, worktrees, and coding agents all exist independently.

Its innovation is architectural and product-level:

1. treating coding-agent sessions as observable engineering sessions
2. connecting local repository evidence with a remote orchestration brain
3. routing development methodology separately from execution runtime
4. maintaining a trusted local boundary around remote agent decisions
5. aiming for continuity across sessions, agents, models, and machines

That combination is uncommon and potentially distinctive.

A reasonable assessment is:

- **Primitive innovation:** moderate
- **System-design innovation:** high
- **Product-category originality:** high, if the control-plane identity remains focused
- **Current defensibility:** limited until routing quality, state continuity, and execution evidence become demonstrably better than a collection of prompts and hooks

## What weakened the previous design

### 1. Skill-library coupling

Hardcoded Superpowers, Matt Pocock, and Antfu sequences made Octowiz look like a workflow menu around other people's commands. It also transferred upstream naming and availability risk into Octowiz.

The v1.1 correction is right:

- Matt Pocock is the primary methodology pack
- Antfu is optional and repository-specific
- core lifecycle, policy, Git operations, and verification belong to Octowiz

Longer term, even Matt Pocock should be resolved through capabilities rather than hardcoded command names.

### 2. Invasive and fragmented lifecycle management

The combination of launchd, a hook-started Python server, path repair, PID files, and session hooks created unclear ownership.

The ephemeral supervisor is a better default because it is:

- visible
- user-scoped
- session-aware
- cross-platform in principle
- removable by ending activity
- not registered with the operating system

Persistent service installation should remain an explicit opt-in for always-on remote tasks.

### 3. Too many product identities in one repository

The codebase currently contains traces of several products:

- Claude Code plugin
- local daemon
- Python A2A agent
- memory CLI
- marketplace client
- setup assistant
- diagnostic assistant
- remote execution bridge

These can coexist, but the boundaries and install surfaces need simplification.

### 4. State is not yet a first-class domain model

The next major step should not be more routing prose. It should be a durable engineering-state model.

Example:

```json
{
  "session": "cc-123",
  "repo": "raelli/octowiz",
  "phase": "implementation",
  "goal": "ephemeral local supervisor",
  "artifact": "issue-42",
  "decisions": ["no automatic OS service"],
  "open_questions": [],
  "acceptance_criteria": ["session lease", "idle exit", "foreign port safety"],
  "evidence": {
    "tests": "pending",
    "lint": "pending",
    "review": "pending"
  }
}
```

Without this, Octowiz risks remaining a smart prompt dispatcher.

## Recommended product evolution

### Stage 1: Make v1.1 trustworthy

Priority order:

1. finish and test the ephemeral supervisor
2. remove all hidden installation and service mutation
3. make setup and doctor deterministic CLI operations
4. define a stable session and repository state schema
5. make verification output machine-readable
6. publish a threat model
7. add end-to-end tests covering two simultaneous sessions and stale-session cleanup

### Stage 2: Introduce capability resolution

Replace direct skill names inside the router with capabilities:

```text
requirements-discovery
plan-stress-test
vertical-slicing
test-driven-implementation
diagnosis
architecture-review
verification
handoff
```

A registry can resolve each capability to:

- Matt Pocock Skills
- native Octowiz behavior
- optional repository-specific packs
- a selected coding runtime

This preserves the Matt-first preference without making the architecture dependent on one external namespace forever.

### Stage 3: Build the engineering state machine

Move from A/B/C/D as fixed routes to a graph of states and evidence-backed transitions.

Example:

```text
explore -> define -> design -> slice -> implement -> verify -> review -> ship
              \                  -> diagnose -> implement
```

The user can still see A/B/C/D, while the engine uses finer states internally.

### Stage 4: Runtime abstraction

Create adapters for:

- Claude Code
- OpenCode
- Codex
- local model agents
- Daytona-hosted agents

Hooks and runtime-specific payloads should normalize into one Octowiz event protocol.

### Stage 5: Multiplayer and autonomous execution

Only after state and verification are reliable:

- one session ledger per repository
- multiple isolated worktrees
- ownership of issues and files
- conflict detection
- shared human steering
- resumable task leases
- signed evidence bundles

This is where the Octowiz and Zellij/OpenCode concept can become genuinely differentiated.

## Product metrics that matter

Avoid measuring only model tokens or tasks completed. Track:

- time from idea to accepted vertical slice
- percentage of tasks resumed successfully in a new session
- percentage of completion claims backed by passing evidence
- human intervention rate by task class
- routing overrides by developers
- false-positive advisories
- conflicts prevented before merge
- setup abandonment rate
- median local runtime lifetime
- autonomous tasks completed without scope drift

## Strategic recommendation

Do not market Octowiz as "an AI coding agent." That category is crowded and would hide its best idea.

Position it as:

> A local-first engineering control plane that gives coding agents shared context, workflow discipline, safe execution boundaries, and continuity across sessions.

The core moat should become:

1. superior engineering-state understanding
2. durable cross-session continuity
3. evidence-backed execution and verification
4. safe coordination between local developer machines and remote intelligence
5. runtime independence

## Final verdict

Octowiz absolutely has substance. It is more than a renamed collection of prompts because the repository already contains real transport, policy, lifecycle, queue, context, and validation machinery.

The project is going in the right direction, but its success depends on disciplined subtraction. The most valuable version of Octowiz is not the one with the most agents, skills, endpoints, or diagrams. It is the one that can answer, reliably and transparently:

1. What is the team trying to achieve?
2. What is true about the repository right now?
3. What is the safest useful next action?
4. Who or what should perform it?
5. What evidence proves it is complete?
6. How can another human or agent continue without reconstructing the story?

If Octowiz becomes excellent at those six questions, it can be a genuinely important layer in agentic software development.
