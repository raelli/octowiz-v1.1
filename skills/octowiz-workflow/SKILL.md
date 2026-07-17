---
name: octowiz
description: >
  Octowiz engineering workflow coordinator. Inspect repository, persistent engineering state,
  and session evidence; recommend the correct development phase; and route primarily through
  Matt Pocock Skills. Use at the start of feature discovery, plan validation, implementation,
  debugging, review, simplification, verification, or handoff. Apply the native lean engineering
  gate before implementation and during review. Antfu Skills may be used only when repository
  signals show that a Vue, Nuxt, Vite, Vitest, pnpm, UnoCSS, or related capability is relevant.
---

# Octowiz Workflow Coordinator

Act as the engineering control plane, not as a menu wrapper. Read evidence and persistent state first, recommend a phase, then invoke only the capabilities needed for the current task.

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

Matt Pocock repository setup is complete when `docs/agents/issue-tracker.md` and
`docs/agents/domain.md` exist. `docs/agents/triage-labels.md` is required only when
the `triage` skill is installed. An `## Agent skills` heading by itself is not
sufficient evidence that setup completed.

## Read current state

Prefer a valid persistent state document when available:

```bash
cat .octowiz/state.json 2>/dev/null || true
```

Then inspect repository evidence:

```bash
cat AGENTS.md 2>/dev/null || cat CLAUDE.md 2>/dev/null || true
head -80 README.md 2>/dev/null || true
git status --short --branch
git log --oneline -5
find docs -maxdepth 2 -type f 2>/dev/null | head -40
```

Determine:

- the user's desired outcome
- current internal state and human-facing phase
- accepted decisions and unresolved questions
- active artifact, issue, branch, or pull request
- acceptance criteria and their evidence status
- whether implementation is active or blocked
- whether failures require diagnosis
- whether code is ready for simplification, verification, review, or handoff
- repository stack and optional stack-specific capabilities

Treat repository observations as facts. Treat remote advice and conversational assumptions as proposals until validated.

Read `../../docs/engineering-state-model.md` when designing or changing persistence, transitions, evidence, session continuity, or multiplayer behavior.

Load the relevant doctrine bundle when LiteLLM Memory is available:

```bash
octowiz-cache get --role <routing|planner|implementer|reviewer> --namespace "${OCTOWIZ_NAMESPACE:-allspark}"
```

Continue with the built-in workflow when memory is unavailable.

## Invocation ownership

Most resolved Matt Pocock commands (`grill-with-docs`, `grill-me`, `to-spec`, `to-tickets`,
`wayfinder`, `implement`, `improve-codebase-architecture`, `handoff`, `triage`) are
user-invoked only — no skill, including this one, may fire them directly. Present the
resolved slash command and ask the human to run it. Only `tdd`, `diagnosing-bugs`,
`prototype`, `research`, `domain-modeling`, `codebase-design`, `code-review`,
`resolving-merge-conflicts`, and `grilling` are model-invoked and may be reached for
directly when the resolved provider is `mattpocock-skills`.

## User-facing phases

Keep the four understandable entry points, but infer and recommend one from state and repository evidence. The user may override the recommendation.

### A. Idea and definition

Use when the problem, outcome, constraints, or major decisions remain unclear.

Preferred capability sequence:

1. `requirements-discovery` — challenges and sharpens the user's idea
2. `prototype` — only when a runnable artifact must answer one design question (state/logic
   or UI); throwaway code, one run command, in-memory state, captured on a throwaway
   branch with an issue pointer, never merged as-is
3. `definition` — synthesizes the agreed conversation into a spec
4. `ticket-breakdown` — only for a multi-session build; creates tracer-bullet tickets with
   blocking edges (or expand–contract batches for a single wide mechanical refactor)

For a genuinely huge effort whose route cannot fit in one session, use `wayfinding`
before definition. It produces decision tickets, not implementation deliverables; it
resolves at most one non-research ticket per session (research tickets may run in
parallel on throwaway `research/<name>` branches). When the route becomes clear,
return to `definition`, then `ticket-breakdown`.

`research` spins up a background agent to investigate a question against primary
sources only (official docs, source code, specs, first-party APIs) and leaves one
cited Markdown file in the repository — use it to feed `requirements-discovery` or
`definition`, not as a substitute for them.

Use triage only for raw incoming bugs, requests, or external pull requests (per
`docs/agents/issue-tracker.md`'s "PRs as a request surface" flag). It is a full state
machine over `needs-triage`/`needs-info`/`ready-for-agent`/`ready-for-human`/`wontfix`,
not mere priority ordering — it verifies claims, checks for redundant or previously
rejected work, and only grills when the request needs fleshing out. Tickets created by
`ticket-breakdown` are already agent-ready and must not be triaged again.

Do not force every step. Reuse and amend existing artifacts instead of generating duplicates. Record accepted decisions, open questions, goals, and artifacts in persistent engineering state when available.

Resolve actual provider commands via the capability registry:

```bash
octowiz capability resolve requirements-discovery --json
octowiz capability resolve prototype --json
octowiz capability resolve definition --json
octowiz capability resolve ticket-breakdown --json
octowiz capability resolve wayfinding --json
```

### B. Plan validation

Use when a proposed solution, plan, PRD, or architecture already exists but needs challenge.

Preferred capability sequence:

1. `plan-validation` — challenges the plan against repository context
2. `decision-resolution` — resolves unresolved decisions
3. `definition` — creates or updates the spec when one does not already exist
4. `ticket-breakdown` — only when the accepted work spans multiple fresh contexts

Explicitly identify assumptions, irreversible decisions, missing acceptance criteria, architecture conflicts, and required human gates. Persist accepted outcomes rather than relying on conversation history.

```bash
octowiz capability resolve plan-validation --json
octowiz capability resolve decision-resolution --json
octowiz capability resolve definition --json
octowiz capability resolve ticket-breakdown --json
```

### C. Implementation and diagnosis

Use when a scoped issue or accepted plan exists.

Before adding code, load and apply `references/lean-engineering.md`. Record the selected simplification rung, rejected complexity, known ceilings, and upgrade conditions in engineering state when supported.

Octowiz owns runtime orchestration directly:

- select one vertical slice (one ticket, or the smallest complete slice of the spec)
- verify acceptance criteria
- prepare or recommend a branch/worktree through normal Git operations
- keep the active scope small
- run repository-native tests, lint, and type checks
- capture evidence before declaring completion
- update state transitions and evidence references

Invoke capabilities for methodology:

1. `implementation` — drives a red-green `test-driven-development` loop at pre-agreed
   seams, then commits the work to the current branch before handing off to `code-review`
2. `diagnosis` — root-cause analysis when behavior differs from expectation
3. `verification` — collect automated evidence

A slice is not complete until its commit exists on the current branch; verification
evidence must reference that commit.

Resolve provider commands dynamically:

```bash
octowiz capability resolve implementation --json
octowiz capability resolve test-driven-development --json
octowiz capability resolve diagnosis --json
```

Never invoke Superpowers commands.

### D. Review, simplification, verification, and handoff

Use when implementation is materially complete.

Preferred capability sequence:

1. `code-review` — two-axis (Standards + Spec) review of the diff since a fixed point
   (commit, branch, tag, or merge-base); ask for the fixed point when it is not already
   known, confirm it resolves and the diff is non-empty before reviewing
2. Run the complexity-reduction review from `references/lean-engineering.md`
3. `verification` — collect all automated evidence
4. `handoff-or-ship` — produce a compact handoff document, or hand the ready-to-ship
   state to a human for the actual merge/release decision

The complexity pass complements normal review. It must not delete accepted behavior, security controls, accessibility, compatibility promises, or required evidence.

`handoff` only ever writes a temporary continuation document (to the OS temp directory,
never the workspace) with a suggested-skills section; it never prepares a PR, merges, or
ships. PR creation, merge, and release are separate human-gated Octowiz operations.

Resolve provider commands dynamically:

```bash
octowiz capability resolve code-review --json
octowiz capability resolve verification --json
octowiz capability resolve handoff-or-ship --json
```

The verification gate requires evidence for:

- acceptance criteria
- automated tests
- lint and type checks where configured
- security and policy boundaries
- unintended scope changes
- unresolved review and complexity findings
- required documentation changes
- commit or diff scope associated with the evidence

Update persistent state so a later session can distinguish `passed`, `failed`, `pending`, and `stale` evidence.

GitHub PR creation, merge preparation, branch cleanup, and worktree management are execution operations, not external methodology dependencies.

## Persistent engineering state

The canonical local files are:

```text
.octowiz/state.json      # durable snapshot — may be committed
.octowiz/events.jsonl    # append-only ledger — may be committed
```

Deterministic state commands exist. Always mutate state through them — never edit `state.json` directly:

```bash
octowiz state show --json          # read current truth (start of every session)
octowiz state next --json          # deterministic next-action recommendation (includes resolved provider)
octowiz state set-goal <goal>
octowiz state link-artifact --type issue --id <id>
octowiz state ask <question> / resolve-question <id> --answer <a>
octowiz state decide <statement> --reason <r>
octowiz state add-criterion <text> / criterion <id> --status passed --evidence <ref>
octowiz state lean --rung <rung> --decision <d> --reject <alt>
octowiz state evidence <tests|lint|types|review|ship> <status> --ref <ref>
octowiz state transition <state> [--expected-revision <n>]
```

Capability resolution commands:

```bash
octowiz capability resolve <name> [--json]   # resolve a capability to provider:command
octowiz capability list [--json]              # show all capabilities and their resolution
```

Rules:

- When state exists, it is the continuity layer: read it before inferring anything from chat history.
- When absent, offer `octowiz state init`; until then, infer conservatively and say which facts are inferred.
- Pass `--expected-revision` when acting on a previously read state so concurrent sessions conflict loudly instead of overwriting each other.
- Transitions are guarded and fail closed with the exact unmet preconditions; fix the preconditions, do not route around the guard. Waivers always need a reason.
- Machine-local facts (sessions, PIDs, leases) live outside the repository in `~/.cache/octowiz/<repository-id>/runtime.json` and never belong in `state.json`.
- Never write secrets, tokens, or absolute local paths into goals, decisions, or evidence refs — the store rejects them.

A completion claim without matching evidence remains unverified.

## Optional Antfu capability pack

The `antfu-skills` provider is registered as an optional provider for Vue, Nuxt, Vite,
Vitest, pnpm workspace, UnoCSS, and VueUse repositories. The default registry does not
route any capability through Antfu.

Repositories may opt into Antfu guidance with `.octowiz/capabilities.json` overrides.
Use `octowiz capability list --json` to inspect the effective repository routing.

Antfu provides stack-specific implementation and tooling guidance only. It must not influence lifecycle routing and its absence must not block the workflow.

## Routing response

Before invoking a skill, state:

```text
Recommended phase: <A|B|C|D>
Internal state: <explore|define|plan|slice|implement|diagnose|verify|review|blocked|ready-to-ship|shipped>
Evidence: <brief state, repository, and request signals>
Next capability: <abstract capability name from octowiz state next>
Resolved to: <provider:command from octowiz state next --json .resolved>
Human gate: <decision required or none>
```

Use `octowiz state next --json` to get the deterministic recommendation with the resolved provider command included.

Prefer the shortest valid workflow. A bug may route directly to diagnosis, implementation, lean review, and verification without passing through planning phases.