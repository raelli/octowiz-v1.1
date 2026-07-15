# Lean engineering gate

Load this reference during phase C before implementation and during phase D for the dedicated complexity-reduction pass. It complements Matt Pocock methodology and the normal Octowiz verification gate. It never replaces correctness, security, performance, accessibility, or architecture review.

This reference adapts the useful anti-over-engineering ideas from Ponytail into an Octowiz-native control gate. The goal is not fewer lines at any cost. The goal is the smallest maintainable change that fully satisfies the accepted requirement.

## Implementation gate

Before adding code, evaluate these options in order and stop at the first one that fully satisfies the requirement:

1. **Do nothing**: reject speculative or already-satisfied work.
2. **Reuse repository capability**: prefer an existing helper, pattern, service, or abstraction.
3. **Use the standard library**: avoid custom infrastructure when the language already provides it.
4. **Use a native platform capability**: prefer browser, database, operating-system, framework, or protocol primitives over custom code.
5. **Use an already-installed dependency**: do not add a new dependency when an existing one is sufficient.
6. **Shrink the design**: reduce files, layers, configuration, states, and code paths while preserving clarity.
7. **Implement the minimum complete slice**: add only what the accepted scope requires.

Do not turn this gate into a research project. Read the affected code, compare realistic options, record the chosen simplification in engineering state, and continue.

## Root-cause rule

For defects, prefer the smallest root-cause fix over repeated symptom guards. Inspect callers and sibling paths before changing shared behavior. A broader fix is acceptable when it removes duplicated patches and is backed by focused verification.

## Forbidden speculative complexity

Avoid unless current evidence requires them:

- interfaces with one implementation
- factories for one construction path
- configuration for values that are not expected to vary
- plugin systems without a second plugin
- generic repositories over one concrete storage mechanism
- new dependencies for trivial language or platform functionality
- compatibility layers for hypothetical consumers
- retry, caching, concurrency, or distributed coordination without a demonstrated need

## Deliberate simplifications

When a simple implementation has a known ceiling, record the ceiling and upgrade condition in the persistent engineering state. A brief code comment is appropriate only when future maintainers need the context at the exact line.

Example state decision:

```json
{
  "decision": "use one process-wide lock",
  "reason": "current runtime is single-user and local",
  "upgradeWhen": "parallel workers create measurable contention"
}
```

Avoid branded comments such as `ponytail:` in Octowiz-owned code. The engineering-state ledger is the primary home for rationale.

## Complexity-reduction review

During phase D, run a dedicated pass after correctness and architecture review. Report only concrete deletion or simplification opportunities.

Use these categories:

- `delete`: functionality, dead code, or flexibility with no current requirement
- `reuse`: duplicate logic already available in the repository
- `stdlib`: custom logic replaced by a standard-library capability
- `native`: custom code or dependency replaced by a platform capability
- `yagni`: premature abstraction, configuration, or extension point
- `shrink`: equivalent behavior with fewer concepts or code paths

Finding format:

```text
<file>:L<line-range> <category>: <what can be removed or simplified>. <replacement or nothing>.
```

Finish with:

```text
complexity delta: -<estimated lines> lines, -<concept count> concepts
```

When there are no meaningful findings:

```text
Lean already. Continue to verification.
```

Do not apply review findings automatically when they alter accepted behavior, public contracts, security controls, or architecture decisions.

## Hard boundaries

Never simplify away:

- validation at trust boundaries
- authorization, authentication, or secret handling
- data-loss prevention and required error handling
- accessibility requirements
- accepted product behavior
- concurrency controls justified by current execution topology
- compatibility promised by a public contract
- repository-native test requirements
- evidence required by the Octowiz verification gate

One-line code is not inherently better than clear code. Fewer concepts and fewer ownership burdens matter more than raw line count.

## State integration

Record meaningful outcomes in the persistent engineering state:

```json
{
  "leanGate": {
    "status": "passed",
    "selectedRung": "reuse-repository-capability",
    "rejectedAlternatives": ["new dependency", "new abstraction"],
    "complexityDelta": {
      "estimatedLines": -42,
      "conceptsRemoved": 2
    }
  }
}
```

The gate must be repeatable by a later session. Do not rely on conversational memory alone.

## Attribution

Conceptually adapted from Ponytail by Yannic Jundt, licensed under MIT. Octowiz changes the emphasis from absolute line minimization to persistent, evidence-backed engineering simplicity.