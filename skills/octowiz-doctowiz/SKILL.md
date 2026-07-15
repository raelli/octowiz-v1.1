---
name: octowiz-doctowiz
description: >
  Diagnose and explain the Octowiz v1.1 runtime, AELLI connectivity, hooks, memory,
  repository policy, and optional skill packs. Use when Octowiz is not starting,
  hooks are not firing, advisories or queued tasks fail, setup is incomplete, or a
  developer wants a transparent activity and security review.
---

# Doctowiz

Diagnose the system without installing packages, registering operating-system services, exposing secrets, or silently changing configuration.

## Modes

- **diagnose**: full health review
- **monitor**: recent local activity and active sessions
- **setup**: explain missing configuration
- **migrate**: remove legacy launchd/systemd integration with explicit approval
- **fix**: repair one identified problem and verify the result

Default to `diagnose`.

## 1. Version and configuration inventory

```bash
node -e "const p=require('$CLAUDE_PLUGIN_ROOT/package.json'); console.log('octowiz', p.version)"
test -n "$AELLI_BASE_URL" && echo 'AELLI_BASE_URL: set' || echo 'AELLI_BASE_URL: missing'
test -n "$AELLI_AUTH_TOKEN" && echo 'AELLI_AUTH_TOKEN: set' || echo 'AELLI_AUTH_TOKEN: missing'
test -n "$AELLI_LITELLM_BASE" && echo 'AELLI_LITELLM_BASE: set' || echo 'AELLI_LITELLM_BASE: optional/unset'
test -n "$OCTOWIZ_ALLOWED_ROOTS" && echo 'OCTOWIZ_ALLOWED_ROOTS: set' || echo 'OCTOWIZ_ALLOWED_ROOTS: missing'
```

Never print token values.

## 2. Ephemeral runtime health

```bash
curl -s -m 3 http://127.0.0.1:${OCTOWIZ_LOCAL_PORT:-8764}/health \
  || echo 'local supervisor: down'

curl -s -m 3 http://127.0.0.1:${OCTOWIZ_A2A_PORT:-8765}/health \
  || echo 'Python A2A: down'
```

A healthy supervisor reports:

```json
{
  "status": "ok",
  "name": "octowiz-local",
  "version": "1.1.0-alpha.1",
  "mode": "ephemeral"
}
```

Interpretation:

- supervisor down outside a Claude Code session: expected
- supervisor down during a session: run `node "$CLAUDE_PLUGIN_ROOT/hooks/scripts/local.js" ensure`
- version differs from the plugin: the next ensure should verify and replace the stale Octowiz process
- unexpected response on the local port: another service owns the port; Octowiz must not stop it
- Python A2A down while supervisor is healthy: inspect `~/.cache/aelli-cc/octowiz-local.log`

Do not use `launchctl` or `systemctl` for the normal v1.1 runtime.

## 3. Hook configuration

Inspect:

```bash
cat "$CLAUDE_PLUGIN_ROOT/hooks/hooks.json"
```

Required lifecycle:

```text
SessionStart  -> local ensure -> session-start event
SessionEnd    -> session-end event -> local release
PostToolUse   -> bridge event
UserPromptSubmit -> bridge event
```

`Stop` is not a session lifecycle signal. Automatic package upgrades must not run from hooks.

## 4. Setup and skill checks

```bash
octowiz-cache check
```

Hard requirements:

- `mattpocock-skills`
- configuration required by the chosen AELLI/LiteLLM deployment

Advisories:

- missing agent instruction file
- Matt Pocock repository setup not yet added
- Antfu may help in a detected Vue/Nuxt/Vite ecosystem

Superpowers and Antfu are never hard requirements.

## 5. Repository policy

```bash
node -e "
const roots=(process.env.OCTOWIZ_ALLOWED_ROOTS||'').split(':').filter(Boolean)
const cwd=process.cwd()
console.log(roots.some(root => cwd.startsWith(root)) ? 'roots: ok' : 'roots: missing')
"
```

Treat allowed roots as a security boundary. Recommend the narrowest practical roots and never add broad home-directory access without explaining the consequence.

## 6. Connectivity

Check the configured endpoints with short timeouts and appropriate authentication, but do not expose headers or secrets. Distinguish:

- local supervisor connectivity
- local Python A2A connectivity
- AELLI API connectivity
- LiteLLM gateway connectivity
- queue subscription failures
- dev-advisor delivery failures

A hook delivery failure should remain fail-open and must not interrupt coding.

## 7. Activity view

```bash
echo '=== Octowiz local ==='
tail -30 ~/.cache/aelli-cc/octowiz-local.log 2>/dev/null || echo '(no local log)'

echo '=== Hook bridge ==='
tail -30 ~/.cache/aelli-cc/aelli-cc.log 2>/dev/null || echo '(no bridge log)'
```

Summarize active session count, the last successful event, the last error, and whether the supervisor is expected to be running.

## 8. Legacy migration

Only when a legacy service is detected, show the exact artifact and request approval before removal.

macOS example:

```bash
launchctl unload ~/Library/LaunchAgents/de.integrahub.octowiz-daemon.plist 2>/dev/null || true
rm -f ~/Library/LaunchAgents/de.integrahub.octowiz-daemon.plist
```

Linux example:

```bash
systemctl --user disable --now octowiz.service
rm -f ~/.config/systemd/user/octowiz.service
systemctl --user daemon-reload
```

These are migration commands, not normal setup commands.

## 9. Fix discipline

Before changing anything:

1. state the observed failure
2. state the proposed change
3. identify files or processes affected
4. avoid destructive action unless ownership is verified
5. apply the smallest fix
6. rerun the relevant health check

End with one of:

- **HEALTHY**: runtime and selected integrations work
- **DEGRADED**: coding works but an optional integration is unavailable
- **UNHEALTHY**: a required dependency, security boundary, or selected deployment connection is broken
