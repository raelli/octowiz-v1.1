---
name: octowiz-engineering-doctrine
description: >
  Octowiz's executable engineering doctrine — the rules, execution shape, and evidence bar
  the selected capability must satisfy. Load when engineering work starts under Octowiz
  routing, when composing a worker brief or delegation (HITL/AFK class, isolation, egress,
  ELLI/AELLI identity boundary), or when another skill needs the completion gate. Supplies
  doctrine only — octowiz-workflow owns phase and provider selection.
---

# Octowiz Executable Engineering Doctrine

This skill composes repository and coding doctrine with the lifecycle phase `octowiz-workflow`
resolves, the Matt Pocock methodology it invokes, and any relevant stack-specific provider. It
does not choose the phase or the provider skill — `octowiz-workflow` owns that. It supplies the
rules, execution shape, and evidence bar the selected capability must satisfy, and it must not be
represented as a standalone workflow.

## When to load which reference

Load only the references the current repository and phase actually need:

- `references/live-baseline.md` — the first production coding doctrine, preserved as an active
  normative source: HITL/AFK classification, context smart-zone, vertical slicing, TDD, deep
  modules, push/pull standards, fresh-context review, human QA, and documentation freshness.
  Load for any meaningful discovery, planning, implementation, or review task. Later rules refine
  this baseline; they must not silently discard its principles.
- `references/executable-engineering-system.md` — the composition contract binding Octowiz
  lifecycle state, repository doctrine, Matt Pocock methodology, stack expertise, coordinator
  execution, and evidence together, plus the authority order to apply when they conflict. Load
  whenever a capability is being selected or composed, not only during implementation.
- `references/coordinator-execution.md` — delegation and concurrency policy: default worker
  topology, what may run in parallel versus what must stay serial, one-writer-per-branch/worktree
  isolation, the worker contract, and model tiering. Load whenever a capability may use advisors,
  subagents, Dynamic Workflows, Managed Agents, background research, or parallel review.
- `references/nuxt-monorepo.md` — optional stack overlay for Nuxt monorepos (`apps/*`, `layers/*`,
  `packages/*` placement and dependency direction). Load only when repository evidence shows a
  Nuxt workspace; it never overrides lifecycle routing or methodology.

## ELLI identity boundary

- **ELLI** is Janis's private coordinator identity and the local TypeScript runtime under
  `apps/elli/` (in `integrahub-control-plane`) — the orchestration plane this doctrine targets.
- **AELLI** is a remote compatibility/provider route exposed through LiteLLM. Select it only when
  a task explicitly targets the remote provider route or a legacy compatibility path.
- Never transfer ELLI's private identity, full personal memory, private prompt segments, or
  unrestricted credentials into AELLI or another worker route.

## Executable rule standard

A doctrine rule is complete only when it binds policy to action: why it applies, which capability
enacts it, what artifact or behavior proves it, how compliance is verified, and what happens on
failure — block the transition, retry an infrastructure failure, request a human decision, or
record an explicit waiver. A rule without an executable method and evidence check is advisory
only and must not be represented as enforced (`references/executable-engineering-system.md`'s
"Executable doctrine contract").

## Completion gate

Do not represent a change as complete without evidence for: accepted acceptance criteria,
focused and full required test suites, lint/typecheck/build where configured, the active doctrine
bundle actually applied, security/privacy/trust-boundary checks, unintended scope changes, and
unresolved review findings or approved waivers (`references/live-baseline.md`'s AFK loop,
`references/executable-engineering-system.md`'s "Completion standard").
