# Coordinator execution and delegation policy

Load this reference when a selected capability may use advisors, subagents, Dynamic
Workflows, Managed Agents, background research, or parallel review.

The selected skill defines the engineering method. This policy defines the execution shape.

## Default topology

Use the smallest topology that preserves quality:

```text
single focused task
  -> one executor

single task with a difficult decision
  -> executor + one bounded advisor

independent read-heavy coverage task
  -> coordinator + parallel restricted workers

independent implementation tickets
  -> coordinator + one writer per isolated worktree

review
  -> independent review axes + final aggregation
```

Do not create workers merely because the runtime supports them.

## Parallelize

Parallel execution is appropriate for:

- independent primary-source research questions
- documentation and codebase mapping with non-overlapping scopes
- verification of separate claims or entities
- Standards and Spec review axes
- independent security, accessibility, dependency, or migration reviews
- unblocked tickets with isolated worktrees and explicit integration order

## Keep serial

Keep these activities serial unless a recorded plan proves independence:

- unresolved human decisions
- one TDD red-green loop within a slice
- edits to the same branch or worktree
- dependent tickets
- state transitions based on the same previously read revision
- schema migrations that require ordered expand-contract steps
- final synthesis and ship approval

## Writing isolation

Default to one writer per branch or worktree.

Parallel writing requires all of the following:

- each worker owns an explicit ticket or file scope
- the tickets are unblocked
- worktrees are isolated
- ownership does not overlap
- acceptance criteria are independently verifiable
- an integration order and conflict strategy are recorded
- every worker returns its commit and evidence bundle

A shared working tree is never a parallel-writing boundary.

## Worker contract

Every delegated task must specify:

- objective and non-objectives
- allowed tools and trust boundary
- repository, branch, worktree, or read-only scope
- authoritative sources and active doctrine
- expected artifact
- verification command or evidence format
- deadline, cancellation, or retry behavior where supported
- whether the worker may write, advise, or only report

Every worker must return:

- direct findings or completed artifact
- sources or repository evidence
- uncertainty and conflicts
- commands run and their results
- changed files and commit when writing
- follow-up needs

An infrastructure failure is not negative evidence. Retry or reassign it explicitly.

## Model tiering

Use the capable coordinator for:

- decomposition
- irreversible or ambiguous decisions
- evidence sufficiency judgment
- conflict resolution
- final synthesis

Use cheaper or faster workers for:

- bounded reading
- structured extraction
- repetitive repository inspection
- focused verification
- well-specified implementation slices that fit their capability

Escalate a worker when the raw material itself requires frontier-level judgment. Do not let a
cheap summary erase the exact detail the coordinator needs.

## Capability-specific policy

### Research

Fan out only after verifying the premise and entity set. Prefer one coherent question per
worker, primary sources only, and one cited result artifact. The coordinator checks coverage
before synthesis.

### Wayfinding

Research tickets may run in parallel. Human-in-the-loop decision tickets remain serial and
must respect blocking edges and claims. Never pre-slice fog that is not yet a precise question.

### Ticket breakdown

The blocking graph is the concurrency plan. Only frontier tickets are candidates for parallel
execution. Wide mechanical migrations use expand-contract ordering instead of forced vertical
parallelism.

### Implementation and TDD

Use one writing owner for each slice. Read-only scouts may inspect APIs, locate prior art, or
analyze failing output in parallel. The red-green loop remains serial at the agreed seam.

### Code review

Keep Standards and Spec as separate parallel axes. Add conditional specialist axes only when
the diff warrants them. Aggregate without reranking one axis over another.

## Usage and evidence

When the runtime exposes thread-level usage, record:

- coordinator and worker models
- input, output, and cache usage per thread
- elapsed time
- retries and failures
- evidence completeness
- cost per delegation or verified claim when relevant

Cost optimization never weakens the accepted verification standard. Compare execution shapes
only under matched rigor.

## Completion gate

Parallel work is complete only when:

- every required worker reached a terminal state
- all evidence is attached to the correct ticket or criterion
- commits are integrated or explicitly pending integration
- conflicts and uncertainty are resolved or recorded
- the final result is checked against the original decomposition
- state was updated using the expected revision
