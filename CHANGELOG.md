# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]
- Added an opt-in Anthropic Managed Agents coordinator path with persisted agent setup, explicit coordinator/worker capability roles, hosted Matt/Antfu/Octowiz skill attachment, session-level write isolation, delegation events, and per-thread usage accounting.

## [1.1.0-alpha.1] - 2026-07-17
### Added
- Introduced the engineering state machine, deterministic next-action routing, artifact links, decision and question tracking, acceptance criteria, lean-design gates, and verification evidence.
- Added capability-based skill resolution with a shipped provider registry and auditable upstream provider contracts.
- Added runtime selection and diagnostics, a unified event protocol, Claude Code execution, and OpenCode and Daytona adapter scaffolding.
- Added multiplayer execution primitives for sessions, task leases, ownership, steering, isolated worktrees, and conflict-aware dispatch.
- Added execution-policy enforcement, workflow scaffolding, A2A coordination, and ephemeral local execution support.

### Changed
- Reworked Octowiz around a Matt Pocock-first workflow and aligned active capability mappings with `mattpocock/skills` 1.1 commands.
- Added the persistent `slice` stage and ticket-breakdown routing, and human-gated skills that upstream marks as user-invoked.
- Removed Superpowers from active runtime, setup, marketplace, and release inputs while retaining explicit legacy migration guards.
- Updated setup detection, workflow guidance, documentation, diagrams, marketplace metadata, and LiteLLM memory exports for the 1.1 architecture.
- Packaged the capability registry and provider contracts in the npm distribution.

### Fixed
- Made `tests/multiplayer/conflicts.test.js` branch-name-agnostic by detecting the temp repo base branch dynamically and using it instead of hardcoded `main` during branch checkouts.
- Removed the remaining hardcoded default-branch checkout in the `returns empty when no overlap` test case to stabilize Node CI jobs across environments where `git init` defaults to `master`.
- Updated README setup instructions to install Python dependencies with `python3 -m pip` so dependency installation matches the interpreter used by the local supervisor (`python3 -m uvicorn`).
- Made malformed local capability overrides fail explicitly with `E_REGISTRY` instead of silently falling back.
- Corrected dispatch and execution compatibility across workflow and runtime paths.
- Pinned the upstream `implement` skill contract, including its OpenAI agent policy that forbids implicit invocation, and added regression coverage.
- Resolved JSDoc lint diagnostics across multiplayer and runtime modules.
