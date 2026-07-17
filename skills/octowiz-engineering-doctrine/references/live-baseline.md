# Live coding doctrine baseline

This reference preserves the first production coding doctrine as an active normative source. It is not historical documentation. Later Octowiz rules refine and operationalize it but must not silently discard its principles.

## Core lifecycle

1. Start with a small context window and a clear brief.
2. Align with the human before planning when intent or tradeoffs remain unclear.
3. Convert shared understanding into a destination document such as a spec or PRD.
4. Convert the destination into dependency-aware, independently grabbable vertical slices.
5. Classify every task as HITL or AFK before delegation.
6. Allow implementation agents to work only on clear, bounded, testable, unblocked AFK tasks.
7. Use TDD and fast repository-native feedback loops.
8. Review in a fresh context with relevant standards pushed into the reviewer context.
9. Keep human QA and final acceptance for product taste, UX, irreversible decisions, and release approval.

## Context smart zone

Long model context is a reliability risk.

- Keep permanent instructions small.
- Load doctrine and skills selectively by phase and stack.
- Prefer a fresh context or isolated worker over repeatedly compacting a swollen implementation thread.
- Separate implementation, final review, and human QA contexts.
- Use read-only subagents for bounded exploration and require compact evidence-backed reports.
- Slice work before implementation when it does not fit one reliable context window.

## Alignment and destination documents

When the request is ambiguous, use one-question-at-a-time alignment and include a recommended answer so the human can accept, modify, or reject quickly.

Surface hidden decisions including data model, permissions, privacy, migration, backfill, failure modes, UX placement, metrics, testability, rollout, and rollback.

The destination document records:

- problem and intended outcome;
- accepted behavior and scenarios;
- explicit implementation and testing decisions;
- modules and public seams likely to change;
- trust boundaries and migration requirements;
- out-of-scope and negative decisions;
- definition of done.

It describes the destination, not a line-by-line implementation plan.

## Vertical slices and task classification

Prefer tracer-bullet issues that cross the minimum required boundaries and produce observable value. Avoid disconnected database-only, API-only, or UI-only phase plans unless the migration strategy requires ordered horizontal work.

Every issue records:

- HITL or AFK classification;
- blockers and dependency edges;
- acceptance criteria;
- intended module or public seam;
- validation commands and manual evidence;
- non-objectives;
- completion artifact.

HITL includes unresolved requirements, product taste, UX direction, architecture or security tradeoffs, irreversible decisions, and final acceptance.

AFK includes well-scoped implementation, test-first service work, mechanical refactors with strong tests, and defects with a clear reproduction and acceptance criteria.

## AFK implementation loop

An AFK executor:

1. reads the active issue and state;
2. selects one highest-priority unblocked task;
3. explores the relevant repository area in a fresh context;
4. runs red, green, refactor at the agreed seam;
5. runs focused tests, typecheck, lint, build, and policy checks;
6. commits one coherent slice;
7. attaches evidence or reports the blocker;
8. stops when no eligible AFK task remains.

It must not pick HITL work, broaden scope silently, combine unrelated issues, or claim completion without evidence.

## Deep modules and interface-first delegation

Prefer deep modules with small public interfaces, meaningful internal behavior, and tests at the boundary. Avoid shallow helper fragmentation that forces agents to reconstruct a broad dependency graph.

For complex delegation:

1. identify the module or service boundary;
2. define the public interface and expected behavior;
3. define tests around that boundary;
4. delegate internals;
5. review behavior, tests, and interface stability.

## Push and pull standards

Implementers use pull mode: relevant doctrine and repository guidance must be retrievable without dumping every standard into every prompt.

Reviewers use push mode: inject the applicable standards, accepted spec, exact diff, and evidence directly into a fresh review context.

## Fresh-context review and human QA

Final review must not reuse a swollen implementation context. Review independently for:

- accepted behavior;
- repository and stack standards;
- test quality and cheating tests;
- security, privacy, permissions, migration, and edge cases;
- module depth and maintainability;
- scope creep and unintended behavior.

Automated review supports but does not replace human QA. Humans retain product taste, UX judgment, final acceptance, and ship approval.

## Parallel execution

Parallelize only after the backlog and blocking graph prove independence.

Each writing worker requires an isolated worktree or branch, non-overlapping ownership, an independently verifiable issue, and an explicit integration order. Review every branch or diff and run full feedback loops after integration.

## Documentation freshness

Active specs and issue plans remain authoritative only while the work is active and accurate. Close, archive, or mark superseded documents after completion. Current code, tests, maintained docs, accepted ADRs, and persistent Octowiz state outrank stale planning documents.

## Modern provider mapping

The baseline's method concepts map to current Octowiz capabilities and installed providers:

- alignment: `requirements-discovery` or `decision-resolution`;
- destination document: `definition`;
- vertical slicing: `ticket-breakdown`;
- implementation: `implementation` and `test-driven-development`;
- defects: `diagnosis`;
- architecture: `codebase-design` or `architecture-review`;
- review: `code-review`, `complexity-review`, and `verification`;
- continuation: `handoff-or-ship`.

Matt Pocock Skills are the primary methodology pack. Stack-specific providers deepen framework mechanics only when relevant. Superpowers references in the first memory export are historical provider options, not a current Octowiz dependency or invocation path.

## Authority

This baseline is active organizational doctrine. Security, privacy, compliance, accepted human decisions, repository ADRs, and explicit waivers remain higher authority. Later doctrine may specialize these rules but must identify any intentional conflict rather than silently replacing them.