# Model routing — plan big, execute small

Coordinator-pattern economics: a frontier model plans, judges, and synthesizes; cheap
workers do the token-heavy legwork in their own context windows and return distilled
reports. The raw bulk a worker reads or writes never enters the coordinator's context —
that separation is the entire cost story.

## Tier table

| Tier | Model | Thinking | Reached via | Owns |
|---|---|---|---|---|
| Coordinator | Claude Fable 5 (the session model — set via `/model`) | session default; think hard at human gates | main loop | phase routing, briefs, synthesis, state mutations, human gates |
| Advisor | `gpt-5.6-sol` (Codex default in `~/.codex/config.toml`) | `model_reasoning_effort=high` | `codex:rescue` skill or `codex-rescue` agent | second opinions at gates: plan validation (phase B), diagnosis stuck after two failed hypotheses, pre-ship review (phase D) |
| Implementer | Claude Sonnet 5 | inherit (Workflow: `effort:'high'` for hard slices) | Agent tool with `model: "sonnet"`; Workflow `agent(…, {model:'sonnet'})` | coding one scoped slice with full repo tools |
| Implementer | `gpt-5.6-terra` (Codex) | `model_reasoning_effort=medium` | `codex exec -m gpt-5.6-terra -s workspace-write -C <repo>` | coding one scoped slice when a cross-model implementation or comparison pass is wanted |
| Sweeper | `gpt-5.6-luna` (Codex) | `model_reasoning_effort=low` | `codex exec -m gpt-5.6-luna -s read-only -C <repo>` | coverage-shaped legwork: log triage, doc reading, codebase sweeps, dependency audits |

Codex worker template:

```bash
codex exec -m gpt-5.6-luna -c model_reasoning_effort="low" -s read-only -C "$PWD" "<brief>"
```

## Delegation rules

- **Brief out, distilled report back.** A brief names one scoped task, the inputs, and
  its completion criterion. The worker returns a distilled report; its raw reading and
  full diffs stay in the worker's context.
- **Matched rigor.** The brief carries the verification standard (which tests, which
  sources, which criteria) — a worker left to its own judgment does less rigorous work
  at the same price. A delegation is complete when the report satisfies the brief's
  stated criterion, with evidence references.
- **Brief granularity has a floor cost.** Each worker pays fixed setup overhead; prefer
  a few substantial briefs over many narrow ones.
- **Keep at the coordinator** what the split can't pay for: narrow tasks with little
  reading to arbitrage, and judgment calls on raw material where a cheap reader would
  summarize away exactly what matters.
- **Verify the decomposition, not only the facts.** When the premise of the split
  matters, spend one sweeper brief checking the task breakdown itself before
  implementers start.
- **Escalate thinking, never downgrade the tier silently.** A worker that misses its
  criterion once retries at the next effort level; a second miss escalates to the
  advisor with both attempts attached.

## Phase mapping

- Phase A/B: coordinator runs the phase; advisor challenges the plan at the human gate.
- Phase C: coordinator slices and briefs; implementers code (Sonnet 5 by default, terra
  for a cross-model pass); sweepers gather diagnosis evidence; advisor on stuck
  diagnosis.
- Phase D: implementer-authored code gets an advisor review pass before `handoff-or-ship`;
  sweepers collect verification evidence.
