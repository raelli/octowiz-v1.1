---
name: setup
description: >
  Configure Octowiz with a Matt Pocock-first workflow and an ephemeral local runtime.
  Use when Octowiz is installed for the first time, when required configuration is
  missing, or when migrating from the legacy launchd/systemd and Superpowers setup.
---

# Octowiz Setup

Configure only what the current machine and repository need. Never install an operating-system service automatically.

## Principles

- Require `mattpocock-skills` for the coding workflow.
- Do not install or request `superpowers`.
- Treat `antfu-skills` as optional and repository-specific.
- Use the ephemeral local supervisor by default.
- Offer persistent launchd/systemd integration only through an explicit future `octowiz service install` command.

## 1. Required plugin

Check for Matt Pocock Skills:

```bash
ls ~/.claude/plugins/cache/*/mattpocock-skills/ 2>/dev/null | head -1
```

When missing:

```bash
claude plugin marketplace add mattpocock/skills
claude plugin install mattpocock-skills@mattpocock
```

## 2. Repository profile

Inspect `package.json`, `pyproject.toml`, workspace files, agent instructions, `CONTEXT.md`, and `docs/adr/`.

Only recommend Antfu Skills when the repository actually uses relevant technologies such as Vue, Nuxt, Vite, Vitest, pnpm workspaces, UnoCSS, or VueUse. Its absence must never block Octowiz.

## 3. Matt Pocock repository setup

`setup-matt-pocock-skills` is user-invoked; Octowiz cannot run it. Setup is complete
when `docs/agents/issue-tracker.md` and `docs/agents/domain.md` exist (and
`docs/agents/triage-labels.md` for a GitHub-backed repository) — not merely when
`## Agent skills` is present. When any required file is missing, ask the user to run:

```text
/mattpocock-skills:setup-matt-pocock-skills
```

Do not create unrelated framework configuration merely to satisfy setup.

## 4. LiteLLM and AELLI

Check the configured gateway and credentials without printing secret values:

```bash
test -n "$LITELLM_BASE_URL" && echo "LiteLLM URL: set" || echo "LiteLLM URL: missing"
test -n "${LITELLM_ADMIN_API_KEY:-$LITELLM_API_KEY}" && echo "LiteLLM key: set" || echo "LiteLLM key: missing"
test -n "$AELLI_AUTH_TOKEN" && echo "AELLI token: set" || echo "AELLI token: missing"
```

Build and verify memory bundles when configured:

```bash
octowiz-cache build --all --namespace "${OCTOWIZ_NAMESPACE:-allspark}"
octowiz-cache get --role routing --namespace "${OCTOWIZ_NAMESPACE:-allspark}" >/dev/null
```

## 5. Local runtime

Do not create files under `~/Library/LaunchAgents`, `~/.config/systemd/user`, or `/etc/systemd`.

The Claude Code `SessionStart` hook runs:

```bash
node "$CLAUDE_PLUGIN_ROOT/hooks/scripts/local.js" ensure
```

This starts one detached user process only when needed, registers a session lease, and returns immediately. `SessionEnd` releases the lease. The supervisor exits after the configured idle period when no sessions remain.

Check it with:

```bash
curl -s http://127.0.0.1:${OCTOWIZ_LOCAL_PORT:-8764}/health
```

Relevant settings:

```text
OCTOWIZ_LOCAL_PORT=8764
OCTOWIZ_IDLE_TIMEOUT_MS=600000
OCTOWIZ_A2A_PORT=8765
```

## 6. Legacy migration

When a legacy LaunchAgent exists, explain the exact removal before acting:

```bash
launchctl unload ~/Library/LaunchAgents/de.integrahub.octowiz-daemon.plist 2>/dev/null || true
rm -f ~/Library/LaunchAgents/de.integrahub.octowiz-daemon.plist
```

Do not remove it without explicit user approval.

For Linux, provide equivalent user-service removal instructions only after detecting an existing Octowiz unit.

## Completion criteria

Setup passes when:

- Matt Pocock Skills are available.
- required LiteLLM/AELLI configuration for the chosen deployment is available.
- the repository has been inspected and optional packs are correctly classified.
- the ephemeral supervisor becomes healthy during a Claude Code session.

Antfu Skills, a persistent OS service, and Superpowers are not completion criteria.
