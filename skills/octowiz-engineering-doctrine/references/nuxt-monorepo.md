# Nuxt monorepo doctrine overlay

Load this optional stack overlay when repository evidence shows Nuxt in a workspace,
especially a structure using `apps/*`, `layers/*`, and `packages/*`.

Octowiz still chooses the lifecycle phase. Matt Pocock Skills still provide the engineering
method. This overlay defines placement, dependency, and evidence constraints for Nuxt work.

## Workspace roles

```text
apps/*      deployable Nuxt applications and composition roots
layers/*    reusable Nuxt behavior, UI, integrations, pages, layouts, and modules
packages/*  framework-neutral or cross-cutting packages, configuration, schemas, and tooling
```

Do not collapse these roles into one undifferentiated package directory.

A repository without `layers/*` may still use the app/package rules. Do not invent layers only
to satisfy this document. Introduce a layer when there is a coherent reusable Nuxt capability.

## Dependency direction

Keep the graph acyclic and directed upward:

```text
packages <- base layer <- UI layer <- domain/integration layer <- app
```

Rules:

- applications may compose and extend layers
- a higher-level layer may extend a lower-level layer
- a lower-level layer must not import from a higher-level layer or application
- applications must not import from other applications
- framework-neutral packages must not depend on applications
- avoid circular `extends` and workspace dependencies
- record deliberate exceptions as ADRs or explicit waivers

## Thin applications

Applications are composition roots, not shared implementation containers.

Applications should primarily own:

- selected layers
- brand-theme selection
- deployment-specific runtime configuration
- application identity and metadata
- genuinely application-specific routes or behavior

Move reusable components, composables, integrations, and domain behavior to the narrowest
coherent layer or package. Do not generalize after only one use unless the boundary is already
clear and valuable.

## Layer responsibilities

Use layers for cohesive Nuxt capabilities such as:

- base platform defaults and common Nuxt modules
- shared UI shell and Nuxt UI configuration
- CMS, commerce, analytics, identity, or another bounded integration

Expose a small composition surface through `nuxt.config.ts`, modules, auto-registration, and
public composables. Consumers should not need internal file paths.

Use stable layer names and aliases only where a direct reference is justified.

## Layer playgrounds

Every reusable layer should have an isolated `.playground` that extends the layer and supports
the relevant development and validation commands:

- development
- build or generate
- typecheck
- lint
- focused tests where present
- preview when useful

A green consuming application does not replace isolated layer validation. A green playground
does not replace consuming-application verification after a public contract change.

## Dependency ownership

Classify dependencies deliberately:

- `peerDependencies`: contracts supplied by the consumer
- `dependencies`: runtime capabilities owned and activated by the workspace
- `devDependencies`: playground, testing, linting, and typechecking tools
- `workspace:*`: internal monorepo dependencies
- pnpm catalog: centrally managed external versions

Do not duplicate unmanaged external versions across workspaces. Treat exact package versions
as repository snapshot data, not universal doctrine.

## Shared configuration

Put cross-cutting configuration in dedicated packages instead of copying it across workspaces:

- ESLint flat configuration
- TypeScript bases
- test configuration
- schemas and validation helpers
- build and release tooling

Local configuration should extend shared configuration and contain only integration-specific
details.

## TypeScript baseline

Prefer a strict baseline, including `strict`, `noUncheckedIndexedAccess`,
`noImplicitOverride`, `isolatedModules`, and `verbatimModuleSyntax` where compatible.
Do not weaken the repository baseline to make one workspace pass. Fix the workspace or record
a narrow exception.

## Design tokens and branding

Separate:

1. brand-independent primitives
2. shared semantic Nuxt UI tokens
3. shared utilities
4. brand-specific values

The application chooses the brand. Shared components consume semantic tokens rather than
hard-coded brand values.

## Content and trust boundaries

Keep CMS-specific modules, pages, layouts, adapters, and error handling inside the CMS or
content capability. Treat CMS and user-supplied content as untrusted:

- restrict protocols and dangerous markup
- make server, client, and Vue-context assumptions explicit
- avoid leaking vendor-specific fetch details through the UI layer
- expose a smaller domain interface where possible

## Validation matrix

Minimum evidence for a changed workspace:

- workspace lint
- workspace typecheck
- focused behavioral tests
- layer playground build or application build as applicable
- consuming-application verification after public contract changes
- root checks when the blast radius crosses workspaces
- dependency-direction and unintended-coupling review

## Skill bindings

### Discovery and design

- `grill-with-docs`: determine whether behavior belongs in an application, layer, or package
- `domain-modeling`: establish domain language for integration and domain layers
- `codebase-design`: design public interfaces and clean seams
- optional Nuxt/Vue provider: verify current framework mechanics

### Definition and planning

- `to-spec`: record placement, dependency direction, public seams, validation, and scope
- `to-tickets`: create vertical slices; use expand-contract for wide mechanical migrations
- `wayfinder`: resolve genuinely large architectural uncertainty before specification

### Implementation

- `implement` and `tdd`: implement one behavior slice at an agreed public seam
- optional Nuxt/Vue provider: advise framework-specific mechanics
- Octowiz: select workspace, worktree, commands, and evidence targets

### Diagnosis

- `diagnosing-bugs`: establish the narrowest reliable reproduction loop, preferably at the
  layer playground or application boundary that exposes the fault

### Review

- `code-review`: keep Standards and Spec independent
- the Standards axis loads this overlay when Nuxt-workspace signals are present
- add conditional security, accessibility, dependency, or migration review when warranted

## Review questions

- Is the behavior in the correct application, layer, or package?
- Does the dependency graph remain acyclic and directed upward?
- Are applications still thin composition roots?
- Is reusable behavior exposed through a public interface?
- Do changed layers work in isolation?
- Are dependencies classified and versioned consistently?
- Are design tokens semantic and brand values isolated?
- Are content and external inputs treated as untrusted?
- Does the evidence cover the changed workspace and its consumers?
