# Releasing & Installing octowiz

Octowiz is a **private** Claude Code plugin. It is not published to any marketplace
feed. There is no server to deploy — "releasing" means bumping the version and
tagging, after which the private install path picks the new version up from this
repository directly.

This repository is the install source. Access is limited to collaborators on
`raelli/octowiz-v1.1`.

---

## Install path

The repository's own `.claude-plugin/marketplace.json` makes it a valid marketplace,
so Claude Code can install straight from the private repo over authenticated git:

```bash
claude plugin marketplace add raelli/octowiz-v1.1   # clones via SSH; registers "octowiz-dev"
claude plugin install octowiz@octowiz-dev
```

Verify it loaded — anything other than `enabled` means the plugin is inert:

```bash
claude plugin list | grep -A3 'octowiz@octowiz-dev'
```

To pick up a new version:

```bash
claude plugin marketplace update octowiz-dev
claude plugin update octowiz@octowiz-dev
```

### Dependency resolution

`mattpocock-skills` is declared with an explicit `marketplace` in
`.claude-plugin/plugin.json`, and `octowiz-dev` allowlists that marketplace via
`allowCrossMarketplaceDependenciesOn`. Both parts are required: bare dependency
names resolve **within the declaring plugin's own marketplace**, and without the
allowlist Claude Code refuses to auto-install a cross-marketplace dependency on a
machine where it is not already present.

The `IntegraHub` marketplace therefore still needs to be configured for the
dependency, even though octowiz itself no longer comes from it.

### Developing against the working tree

To run the plugin from local edits rather than the pushed HEAD, point a marketplace
at the checkout instead. Only one marketplace may hold the `octowiz-dev` name at a
time, so remove the repo-sourced one first:

```bash
claude plugin marketplace remove octowiz-dev
claude plugin marketplace add /path/to/octowiz-v1.1
```

---

## Release checklist

Run through this before tagging. Every item must be green before the PR merges.

**Pre-merge**
- [ ] `package.json` version bumped (e.g. `1.1.2` → `1.1.3`)
- [ ] `.claude-plugin/plugin.json` version bumped to the same value
  — both files **must** match; a missing `plugin.json` version breaks plugin update
- [ ] `pyproject.toml` `version =` bumped to the same value
  — mismatched Python metadata makes `pip show octowiz` and upgrade diagnostics unreliable
- [ ] `pnpm test` — all tests green locally
- [ ] `nr lint --fix` run; no lint errors
- [ ] `claude plugin validate .` passes
- [ ] PR opened, reviewed, squash-merged to main

**Tag & release**
- [ ] `git tag v<version>` on the merge commit, `git push origin v<version>`
- [ ] GitHub release created from the tag with a short changelog
- [ ] `release.yml` workflow completes without error

**Post-release verification**
- [ ] `claude plugin marketplace update octowiz-dev` succeeds
- [ ] `claude plugin update octowiz@octowiz-dev` installs the new version without error
- [ ] `claude plugin list` reports `octowiz@octowiz-dev` as `enabled` at the new version
- [ ] Hook tags in the terminal show the expected `[--*] HH:MM:SS [octowiz - <action>]` format

---

## Version bump locations

| File | Field |
|---|---|
| `package.json` | `"version"` |
| `.claude-plugin/plugin.json` | `"version"` |
| `pyproject.toml` | `version =` |

All three must be identical. Verify before tagging:

```bash
node -e "console.log(require('./package.json').version)" && \
node -e "console.log(require('./.claude-plugin/plugin.json').version)" && \
python3 -c "
import re, pathlib
m = re.search(r'^version\s*=\s*\"(.+?)\"', pathlib.Path('pyproject.toml').read_text(), re.M)
print(m.group(1) if m else 'NOT FOUND')
"
```

All three lines must print the same value.

---

## History

Until July 2026 this plugin was published to the IntegraHub marketplace
(`https://llm.integrahub.de/claude-code/marketplace.json`) under the entry name
`octowiz-aellvanse`, upserted by CI on every release. That publishing path has been
removed: `marketplace-sync.yml` is deleted and the upsert step is gone from
`release.yml`, so a release can no longer re-create the entry.

The plain `octowiz` marketplace entry belongs to
[`raelli/octowiz`](https://github.com/raelli/octowiz), the public 0.9.x
memory-stack plugin. It is unaffected and must never be upserted from this repo.

`secrets.LITELLM_MASTER_KEY` is no longer read by any workflow here and can be
removed from this repository's Actions secrets.
