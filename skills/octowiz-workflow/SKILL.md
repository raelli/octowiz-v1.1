---
name: octowiz
description: >
  Octowiz engineering workflow coordinator. Inspect repository and session state,
  recommend the correct development phase, and route primarily through Matt Pocock
  Skills. Use at the start of feature discovery, plan validation, implementation,
  debugging, review, or handoff. Antfu Skills may be used only when repository signals
  show that a Vue, Nuxt, Vite, Vitest, pnpm, UnoCSS, or related stack capability is relevant.
---

# Octowiz Workflow Coordinator

Act as the engineering control plane, not as a menu wrapper. Read evidence first, recommend a phase, then invoke only the capabilities needed for the current task.

## Pre-flight

The local runtime is ephemeral. Do not inspect or install launchd/systemd services.

Check the supervisor:

```bash
curl -s http://127.0.0.1:${OCTOWIZ_LOCAL_PORT:-8764}/health
```

If unavailable during a Claude Code session, run:

```bash
node "$CLAUDE_PLUGIN_ROOT/hooks/scripts/local.js" ensure
```

Run the setup skill only for genuine configuration gaps. Superpowers and Antfu are never hard setup requirements.

## Read current state

Inspect:

```bash
cat AGENTS.md 2>/dev/null || cat CLAUDE.md 2>/dev/null || true
head -80 README.md 2>/dev/null || true
git status --short --branch
git log --oneline -5
find docs -maxdepth 2 -type f 2>/dev/null | head -40
```

Determine:

- the user's desired outcome
- whether requirements and decisions are unresolved
- whether an accepted plan or PRD exists
- whether implementation is active
- whether failures require diagnosis
- whether code is ready for review or handoff
- repository stack and optional stack-specific capabilities

Load the relevant doctrine bundle when LiteLLM Memory is available:

```bash
octowiz-cache get --role <routing|planner|implementer|reviewer> --namespace "${OCTOWIZ_NAMESPACE:-allspark}"
```

Continue with the built-in workflow when memory is unavailable.

## User-facing phases

Keep the four understandable entry points, but infer and recommend one from repository evidence. The user may override the recommendation.

### A. Idea and definition

Use when the problem, outcome, constraints, or major decisions remain unclear.

Preferred sequence:

1. `/mattpocock-skills:grill-me`
2. `/mattpocock-skills:grill-with-docs` when `CONTEXT.md`, ADRs, or substantial domain documentation exist
3. `/mattpocock-skills:prototype` only to test a risky technical assumption
4. `/mattpocock-skills:to-prd`
5. `/mattpocock-skills:to-issues`
6. `/mattpocock-skills:triage`

Do not force every step. Reuse and amend existing artifacts instead of generating duplicates.

### B. Plan validation

Use when a proposed solution, plan, PRD, or architecture already exists but needs challenge.

Preferred sequence:

1. `/mattpocock-skills:grill-with-docs` when repository context exists
2. `/mattpocock-skills:grill-me` for unresolved decisions
3. update or create the PRD with `/mattpocock-skills:to-prd`
4. `/mattpocock-skills:to-issues`
5. `/mattpocock-skills:triage`

Explicitly identify assumptions, irreversible decisions, missing acceptance criteria, and architecture conflicts.

### C. Implementation and diagnosis

Use when a scoped issue or accepted plan exists.

Octowiz owns runtime orchestration directly:

- select one vertical slice
- verify acceptance criteria
- prepare or recommend a branch/worktree through normal Git operations
- keep the active scope small
- run repository-native tests, lint, and type checks
- capture evidence before declaring completion

Use Matt Pocock Skills for methodology:

1. `/mattpocock-skills:tdd`
2. implement the smallest passing slice
3. `/mattpocock-skills:diagnose` when behavior differs from expectation
4. `/mattpocock-skills:prototype` when an uncertain approach should be tested cheaply

Never invoke Superpowers commands.

### D. Review, verification, and handoff

Use when implementation is materially complete.

Preferred sequence:

1. `/mattpocock-skills:zoom-out`
2. inspect the diff against requirements and wider architecture
3. `/mattpocock-skills:improve-codebase-architecture` only when structural issues are found
4. run the native Octowiz verification gate
5. `/mattpocock-skills:handoff`

The verification gate requires evidence for:

- acceptance criteria
- automated tests
- lint and type checks where configured
- security and policy boundaries
- unintended scope changes
- unresolved review findings
- required documentation changes

GitHub PR creation, merge preparation, branch cleanup, and worktree management are execution operations, not external methodology dependencies.

## Optional Antfu capability pack

Detect repository relevance before suggesting Antfu Skills. Valid signals include direct dependencies or configuration for Vue, Nuxt, Vite, Vitest, pnpm workspaces, UnoCSS, or VueUse.

Use Antfu only for stack-specific implementation and tooling guidance. It must not influence lifecycle routing and its absence must not block the workflow.

## Routing response

Before invoking a skill, state:

```text
Recommended phase: <A|B|C|D>
Evidence: <brief repository and request signals>
Next capability: <Matt Pocock skill or native Octowiz operation>
Human gate: <decision required or none>
```

Prefer the shortest valid workflow. A bug may route directly to diagnosis, implementation, and verification without passing through planning phases.
