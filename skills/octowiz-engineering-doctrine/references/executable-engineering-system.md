# Executable engineering system

Load this reference whenever Octowiz selects or composes an engineering capability.
It defines how policy, methodology, stack expertise, orchestration, and evidence work
together. It is not a standalone workflow and does not replace the selected provider skill.

## Core model

```text
Engineering result
  = Octowiz lifecycle and persistent state
  + repository and GFE coding doctrine
  + Matt Pocock methodology skills
  + stack-specific expertise
  + coordinator execution topology
  + repository-native evidence
```

Everything is combined at the system level. Only the phase-relevant and stack-relevant
bundle is loaded for a particular task.

## Responsibilities

### Octowiz

- reads persistent state and repository evidence
- determines the current engineering phase
- resolves abstract capabilities to concrete provider skills
- selects the relevant doctrine overlays
- applies human gates and guarded transitions
- selects runtime, branch, worktree, and evidence requirements
- records decisions, criteria, waivers, and verification results

### Coding doctrine

- defines non-negotiable and preferred engineering rules
- describes when each rule applies
- binds each rule to concrete capabilities and checks
- supplies repository-specific standards for review
- defines explicit exception and waiver behavior

### Matt Pocock Skills

- provide the executable method for discovery, domain modeling, planning, ticketing,
  prototyping, TDD, diagnosis, implementation, research, and review
- remain concrete capabilities, not prose copied into Octowiz
- own their methodology while Octowiz owns lifecycle and state

### Stack-specific providers

- provide current framework knowledge for relevant ecosystems
- do not own lifecycle routing
- are invoked only when repository signals and the selected task require them
- may advise a Matt capability but must not silently replace it

### Coordinator execution pattern

- chooses worker topology and model tiering for the selected capability
- parallelizes independent read-heavy work
- isolates contexts, tools, branches, and worktrees
- preserves one writer per branch or worktree by default
- records delegation outcomes, evidence, retries, usage, and uncertainty

## Executable doctrine contract

A doctrine rule is complete only when it binds policy to action:

```yaml
id: nuxt.layer-dependency-direction
rule: Lower layers must not depend on higher layers or applications.
applies_when:
  - nuxt
  - monorepo
  - layers
capabilities:
  discovery: codebase-design
  planning: definition
  implementation: implementation
  review: code-review
checks:
  - inspect the Nuxt extends graph
  - inspect workspace dependency direction
  - detect circular or upward imports
failure_action: block review or record an explicit waiver
```

Every active rule must answer:

1. Why does it apply to this repository and change?
2. Which capability helps achieve it?
3. Which artifact or behavior should the capability produce?
4. How will compliance be verified?
5. What happens when verification fails?

Do not merely tell the developer to follow a rule. Route to the method and produce the
evidence needed to prove it.

## Runtime bundle selection

### Discovery

Load:

- current state and repository facts
- the resolved requirements-discovery or plan-validation skill
- domain and architecture doctrine relevant to the area
- stack guidance only for uncertain framework mechanics

Do not preload implementation and review doctrine unless the flow reaches those phases.

### Definition and ticketing

Load:

- accepted decisions and open questions
- the resolved definition or ticket-breakdown skill
- architecture, trust-boundary, migration, and verification constraints
- stack-specific placement and public-interface rules

The specification records the destination. Tickets record independently verifiable vertical
slices and their blocking edges.

### Implementation

Load:

- the accepted spec and current ticket
- the lean gate
- active repository and stack doctrine
- the resolved implementation and TDD methodology
- the coordinator policy for isolated execution
- repository-native validation commands

Use one writing owner per branch or worktree. Read-only specialists may work in parallel.

### Review

Run independent axes for:

- specification compliance
- repository standards and active doctrine
- complexity reduction
- conditional security, accessibility, dependency, migration, or performance risks

Keep findings separated by axis so one kind of success cannot hide another kind of failure.

## Authority and conflicts

Apply authority in this order:

1. security, privacy, compliance, and trust-boundary controls
2. accepted specification, ADRs, and explicit human decisions
3. repository-specific and organizational doctrine
4. concrete provider methodology
5. generic framework or model advice

When an accepted decision conflicts with doctrine, record a waiver with rationale,
consequences, and a reversal or upgrade condition. Never silently choose one side.

When methodology conflicts with project constraints, preserve the method's intent while the
project constraint wins. For example, retain TDD but use the repository's approved public seam.

## Completion standard

A completion statement must include or point to:

- the accepted criteria
- the concrete capability and provider used
- the active doctrine bundle
- the implementation commit or reviewed diff
- automated and manual evidence
- unresolved findings or approved waivers

Without matching evidence, the result remains unverified.