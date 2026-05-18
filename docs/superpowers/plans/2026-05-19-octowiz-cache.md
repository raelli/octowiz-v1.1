# Octowiz Memory Bundle Caching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local cache layer (`octowiz-cache`) that stores stable role doctrine bundles on disk so `/octowiz` loads instantly without requiring a live LiteLLM connection on every run.

**Architecture:** `octowiz_cache.py` is a deep module with pure hashing/rendering functions, manifest read/write, and an httpx-backed fetch pipeline. A thin argparse CLI wraps it as an `octowiz-cache` console script installed via `pyproject.toml`. The `/octowiz` skill's Step 2 is updated to call `octowiz-cache get --role routing` instead of `curl`, with stderr surfaced (not suppressed).

**Tech Stack:** Python 3.8+, httpx (already in requirements.txt), stdlib `unittest`, `unittest.mock`, `tempfile`, `os.replace` for atomic writes.

**PRD:** https://github.com/raelli/octowiz/issues/7

---

### Task 1: Pure functions + full test skeleton

**Files:**
- Create: `octowiz_cache.py`
- Create: `tests/test_octowiz_cache.py`

The pure functions (`hash_memory`, `hash_bundle`, `render_bundle`, `manifest_is_fresh`) have no I/O and are tested first. All 10 test cases land in this task using `unittest.mock` for the LiteLLM-touching ones — no real network calls in any test.

- [ ] **Step 1: Write tests/test_octowiz_cache.py**

```python
import hashlib
import json
import os
import sys
import tempfile
import time
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import octowiz_cache


class TestHashMemory(unittest.TestCase):
    def test_same_content_same_hash(self):
        m = {"key": "team:allspark:playbook:overview", "value": "Plan first.", "metadata": {}}
        self.assertEqual(octowiz_cache.hash_memory(m), octowiz_cache.hash_memory(m))

    def test_changed_value_changes_hash(self):
        m1 = {"key": "team:allspark:playbook:overview", "value": "Plan first.", "metadata": {}}
        m2 = {"key": "team:allspark:playbook:overview", "value": "Plan first. Then test.", "metadata": {}}
        self.assertNotEqual(octowiz_cache.hash_memory(m1), octowiz_cache.hash_memory(m2))


class TestHashBundle(unittest.TestCase):
    def test_same_memories_same_bundle_hash(self):
        memories = [{"key": "team:allspark:playbook:overview", "value": "v1", "metadata": {}}]
        self.assertEqual(
            octowiz_cache.hash_bundle("planner", memories),
            octowiz_cache.hash_bundle("planner", memories),
        )

    def test_changed_memory_changes_bundle_hash(self):
        m_a = {"key": "team:allspark:playbook:overview", "value": "Plan first.", "metadata": {}}
        m_b = {"key": "team:allspark:playbook:overview", "value": "Plan first. Then test.", "metadata": {}}
        self.assertNotEqual(
            octowiz_cache.hash_bundle("planner", [m_a]),
            octowiz_cache.hash_bundle("planner", [m_b]),
        )


class TestRenderBundle(unittest.TestCase):
    def test_rendering_is_deterministic(self):
        memories = [
            {"key": "team:allspark:playbook:b", "value": "Beta", "metadata": {}},
            {"key": "team:allspark:playbook:a", "value": "Alpha", "metadata": {}},
        ]
        r1 = octowiz_cache.render_bundle("planner", memories)
        r2 = octowiz_cache.render_bundle("planner", memories)
        self.assertEqual(r1, r2)

    def test_memories_sorted_by_key(self):
        memories = [
            {"key": "team:allspark:playbook:z", "value": "Zeta", "metadata": {}},
            {"key": "team:allspark:playbook:a", "value": "Alpha", "metadata": {}},
        ]
        result = octowiz_cache.render_bundle("planner", memories)
        idx_a = result.index("team:allspark:playbook:a")
        idx_z = result.index("team:allspark:playbook:z")
        self.assertLess(idx_a, idx_z)

    def test_value_passed_through_as_is(self):
        raw_json = '{"entry_points": {"A": ["key1"]}}'
        memories = [{"key": "team:allspark:config:contract", "value": raw_json, "metadata": {}}]
        result = octowiz_cache.render_bundle("routing", memories)
        self.assertIn(raw_json, result)

    def test_never_contains_dynamic_context_markers(self):
        memories = [{"key": "team:allspark:playbook:overview", "value": "Doctrine.", "metadata": {}}]
        result = octowiz_cache.render_bundle("planner", memories)
        for forbidden in ("git status", "git diff", "test output", "user request"):
            self.assertNotIn(forbidden, result)


class TestManifestIsFresh(unittest.TestCase):
    def test_fresh_manifest_returns_true(self):
        manifest = {"updated_at": time.time() - 100}
        self.assertTrue(octowiz_cache.manifest_is_fresh(manifest, ttl_seconds=3600))

    def test_expired_manifest_returns_false(self):
        manifest = {"updated_at": time.time() - 4000}
        self.assertFalse(octowiz_cache.manifest_is_fresh(manifest, ttl_seconds=3600))


class TestFetchMemoryMissing(unittest.TestCase):
    def test_404_raises_with_key_name(self):
        import httpx
        mock_response = MagicMock()
        mock_response.raise_for_status.side_effect = httpx.HTTPStatusError(
            "404", request=MagicMock(), response=MagicMock(status_code=404)
        )
        mock_client = MagicMock()
        mock_client.get.return_value = mock_response
        with self.assertRaises(Exception) as ctx:
            octowiz_cache.fetch_memory(mock_client, "team:allspark:playbook:missing-key")
        self.assertIn("team:allspark:playbook:missing-key", str(ctx.exception))


class TestMissingEnvRaisesHelpfulError(unittest.TestCase):
    def test_no_api_key_raises_runtime_error(self):
        env = {"LITELLM_BASE_URL": "http://localhost:4000"}
        with patch.dict(os.environ, env, clear=True):
            for var in ("LITELLM_ADMIN_API_KEY", "LITELLM_API_KEY"):
                os.environ.pop(var, None)
            with self.assertRaises(RuntimeError) as ctx:
                octowiz_cache.get_litellm_client()
        self.assertIn("LITELLM_ADMIN_API_KEY", str(ctx.exception))


class TestRefreshMemoryBypassesCache(unittest.TestCase):
    def test_refresh_flag_triggers_fetch(self):
        memory = {"key": "team:allspark:playbook:overview", "value": "Doctrine.", "metadata": {}}
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch("octowiz_cache.fetch_role_memories", return_value=[memory]) as mock_fetch:
                with patch("octowiz_cache.get_litellm_client", return_value=MagicMock()):
                    octowiz_cache.get_bundle(
                        role="planner",
                        namespace="allspark",
                        cache_dir=tmpdir,
                        ttl_seconds=3600,
                        refresh=True,
                    )
                mock_fetch.assert_called_once()


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run tests — confirm they fail with ImportError**

```bash
python -m pytest tests/test_octowiz_cache.py -v 2>&1 | head -20
```

Expected: `ModuleNotFoundError: No module named 'octowiz_cache'`

- [ ] **Step 3: Create octowiz_cache.py with pure functions only**

```python
from __future__ import annotations

import hashlib
import json
import os
import time
import urllib.parse
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    import httpx
except ImportError:
    print("Missing dependency: httpx. Install with: pip install httpx", file=__import__("sys").stderr)
    raise SystemExit(2)


ROLE_MEMORY_KEYS: Dict[str, List[str]] = {
    "planner": [
        "team:{namespace}:playbook:ai-coding-workflow:overview",
        "team:{namespace}:playbook:ai-coding-workflow:grill-me-alignment",
        "team:{namespace}:playbook:ai-coding-workflow:prd-destination-document",
        "team:{namespace}:playbook:ai-coding-workflow:kanban-tracer-bullets",
        "team:{namespace}:playbook:ai-coding-workflow:skill-sources",
        "agent:planner:memory:ai-coding-workflow",
    ],
    "implementer": [
        "team:{namespace}:playbook:ai-coding-workflow:context-smart-zone",
        "team:{namespace}:playbook:ai-coding-workflow:tdd-feedback-loops",
        "team:{namespace}:playbook:ai-coding-workflow:ralph-loop",
        "team:{namespace}:skills:matt-pocock:ai-engineering",
        "team:{namespace}:skills:obra-superpowers:agent-methodology",
        "agent:implementer:memory:ai-coding-workflow",
    ],
    "reviewer": [
        "team:{namespace}:playbook:ai-coding-workflow:fresh-context-review",
        "team:{namespace}:playbook:ai-coding-workflow:push-pull-standards",
        "team:{namespace}:skills:obra-superpowers:agent-methodology",
        "agent:reviewer:memory:ai-coding-workflow",
    ],
    "qa": [
        "team:{namespace}:playbook:ai-coding-workflow:manual-qa-taste",
        "team:{namespace}:playbook:ai-coding-workflow:frontend-prototypes",
        "agent:qa:memory:ai-coding-workflow",
    ],
    "routing": [
        "team:{namespace}:config:retrieval-contract",
        "team:{namespace}:skills:matt-pocock:ai-engineering",
        "team:{namespace}:skills:obra-superpowers:agent-methodology",
    ],
}

DEFAULT_CACHE_DIR = Path.home() / ".cache" / "octowiz"
DEFAULT_TTL_SECONDS = 3600


def hash_memory(memory: Dict[str, Any]) -> str:
    payload = {
        "key": memory["key"],
        "value": memory["value"],
        "metadata": memory.get("metadata", {}),
    }
    raw = json.dumps(payload, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def hash_bundle(role: str, memories: List[Dict[str, Any]]) -> str:
    payload = {
        "role": role,
        "memory_hashes": [
            hash_memory(m) for m in sorted(memories, key=lambda m: m["key"])
        ],
    }
    raw = json.dumps(payload, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def render_bundle(role: str, memories: List[Dict[str, Any]]) -> str:
    lines = [
        f"# Octowiz Doctrine Bundle: {role}",
        "",
        "Stable workflow doctrine loaded from LiteLLM memory.",
        "Append fresh project state, git status, and user request after this bundle.",
        "",
        "---",
        "",
    ]
    for memory in sorted(memories, key=lambda m: m["key"]):
        lines.extend([
            f"## {memory['key']}",
            "",
            memory["value"].strip(),
            "",
            "---",
            "",
        ])
    return "\n".join(lines).strip() + "\n"


def manifest_is_fresh(manifest: Dict[str, Any], ttl_seconds: int) -> bool:
    updated_at = manifest.get("updated_at", 0)
    return time.time() - updated_at < ttl_seconds


def get_litellm_client() -> "httpx.Client":
    base_url = os.getenv("LITELLM_BASE_URL", "http://localhost:4000").rstrip("/")
    api_key = os.getenv("LITELLM_ADMIN_API_KEY") or os.getenv("LITELLM_API_KEY")
    if not api_key:
        raise RuntimeError(
            "Set LITELLM_ADMIN_API_KEY or LITELLM_API_KEY to fetch Octowiz memories."
        )
    return httpx.Client(
        base_url=base_url,
        headers={"Authorization": f"Bearer {api_key}"},
        timeout=30.0,
    )


def fetch_memory(client: "httpx.Client", key: str) -> Dict[str, Any]:
    encoded = urllib.parse.quote(key, safe="")
    try:
        response = client.get(f"/v1/memory/{encoded}")
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            raise KeyError(f"Memory key not found in LiteLLM: {key!r}") from exc
        raise
    data = response.json()
    value = data.get("value") or data.get("memory") or ""
    if not isinstance(value, str):
        import sys
        print(
            f"[octowiz-cache] WARNING: unexpected value type for {key!r}: {type(value).__name__}",
            file=sys.stderr,
        )
        value = json.dumps(value)
    return {"key": key, "value": value, "metadata": data.get("metadata", {})}


def fetch_role_memories(
    client: "httpx.Client", role: str, namespace: str
) -> List[Dict[str, Any]]:
    keys = [
        k.replace("{namespace}", namespace)
        for k in ROLE_MEMORY_KEYS[role]
    ]
    return [fetch_memory(client, key) for key in keys]


def _namespace_cache_dir(cache_dir: Path, namespace: str) -> Path:
    return cache_dir / "namespaces" / namespace


def _read_manifest(ns_dir: Path) -> Optional[Dict[str, Any]]:
    manifest_path = ns_dir / "manifest.json"
    if not manifest_path.exists():
        return None
    with open(manifest_path, "r", encoding="utf-8") as f:
        return json.load(f)


def _write_manifest(ns_dir: Path, manifest: Dict[str, Any]) -> None:
    ns_dir.mkdir(parents=True, exist_ok=True)
    target = ns_dir / "manifest.json"
    tmp = target.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
    os.replace(tmp, target)


def _read_bundle(ns_dir: Path, role: str, bundle_hash: str) -> Optional[str]:
    bundle_path = ns_dir / "bundles" / role / f"{bundle_hash}.md"
    if not bundle_path.exists():
        return None
    return bundle_path.read_text(encoding="utf-8")


def _write_bundle(ns_dir: Path, role: str, bundle_hash: str, content: str) -> Path:
    bundle_dir = ns_dir / "bundles" / role
    bundle_dir.mkdir(parents=True, exist_ok=True)
    target = bundle_dir / f"{bundle_hash}.md"
    tmp = target.with_suffix(".md.tmp")
    tmp.write_text(content, encoding="utf-8")
    os.replace(tmp, target)
    return target


def get_bundle(
    role: str,
    namespace: str,
    cache_dir: Any = None,
    ttl_seconds: int = DEFAULT_TTL_SECONDS,
    refresh: bool = False,
) -> str:
    import sys

    if cache_dir is None:
        cache_dir = Path(os.getenv("OCTOWIZ_CACHE_DIR", DEFAULT_CACHE_DIR))
    cache_dir = Path(cache_dir)
    ns_dir = _namespace_cache_dir(cache_dir, namespace)

    if not refresh:
        manifest = _read_manifest(ns_dir)
        if manifest and manifest_is_fresh(manifest, ttl_seconds):
            role_entry = manifest.get("roles", {}).get(role)
            if role_entry:
                content = _read_bundle(ns_dir, role, role_entry["bundle_hash"])
                if content is not None:
                    return content

    try:
        client = get_litellm_client()
        with client:
            memories = fetch_role_memories(client, role, namespace)
    except Exception as exc:
        manifest = _read_manifest(ns_dir)
        if manifest:
            role_entry = manifest.get("roles", {}).get(role)
            if role_entry:
                content = _read_bundle(ns_dir, role, role_entry["bundle_hash"])
                if content is not None:
                    age = int(time.time() - manifest.get("updated_at", 0))
                    print(
                        f"[octowiz-cache] LiteLLM unavailable ({exc}) — "
                        f"serving stale bundle for role '{role}' (updated {age}s ago)",
                        file=sys.stderr,
                    )
                    return content
        raise

    bundle_hash = hash_bundle(role, memories)
    content = render_bundle(role, memories)
    bundle_path = _write_bundle(ns_dir, role, bundle_hash, content)

    manifest = _read_manifest(ns_dir) or {
        "namespace": namespace,
        "ttl_seconds": ttl_seconds,
        "roles": {},
    }
    manifest["updated_at"] = time.time()
    manifest["roles"][role] = {
        "bundle_hash": bundle_hash,
        "bundle_path": str(bundle_path.relative_to(ns_dir)),
        "memory_hashes": {m["key"]: hash_memory(m) for m in memories},
    }
    _write_manifest(ns_dir, manifest)
    return content
```

- [ ] **Step 4: Run tests — confirm pure-function and mock tests pass**

```bash
python -m pytest tests/test_octowiz_cache.py -v
```

Expected: 10+ tests PASSED (some may be skipped if `get_bundle` not yet wired — that is fine; the mock tests for `get_bundle` should pass since the function exists).

- [ ] **Step 5: Commit**

```bash
git add octowiz_cache.py tests/test_octowiz_cache.py
git commit -m "feat: add octowiz_cache module — hashing, rendering, manifest, fetch, pipeline"
```

---

### Task 2: Manifest read/write with temp directory tests

**Files:**
- Modify: `tests/test_octowiz_cache.py`

- [ ] **Step 1: Append manifest I/O tests**

Add this class to `tests/test_octowiz_cache.py`:

```python
class TestManifestReadWrite(unittest.TestCase):
    def test_write_and_read_manifest_roundtrip(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            ns_dir = Path(tmpdir) / "namespaces" / "allspark"
            manifest = {
                "namespace": "allspark",
                "updated_at": 1760000000.0,
                "ttl_seconds": 3600,
                "roles": {
                    "planner": {
                        "bundle_hash": "abc123",
                        "bundle_path": "bundles/planner/abc123.md",
                        "memory_hashes": {"team:allspark:playbook:overview": "def456"},
                    }
                },
            }
            octowiz_cache._write_manifest(ns_dir, manifest)
            result = octowiz_cache._read_manifest(ns_dir)
        self.assertEqual(result["namespace"], "allspark")
        self.assertIn("planner", result["roles"])

    def test_read_missing_manifest_returns_none(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            ns_dir = Path(tmpdir) / "namespaces" / "allspark"
            result = octowiz_cache._read_manifest(ns_dir)
        self.assertIsNone(result)

    def test_write_bundle_creates_file(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            ns_dir = Path(tmpdir) / "namespaces" / "allspark"
            path = octowiz_cache._write_bundle(ns_dir, "planner", "abc123", "# Doctrine\n")
            self.assertTrue(path.exists())
            self.assertEqual(path.read_text(), "# Doctrine\n")

    def test_write_bundle_atomic_no_tmp_left_behind(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            ns_dir = Path(tmpdir) / "namespaces" / "allspark"
            octowiz_cache._write_bundle(ns_dir, "planner", "abc123", "# Doctrine\n")
            tmp_files = list((ns_dir / "bundles" / "planner").glob("*.tmp"))
        self.assertEqual(tmp_files, [])
```

- [ ] **Step 2: Add `from pathlib import Path` import at top of test file if not present**

Ensure `from pathlib import Path` is at the top of `tests/test_octowiz_cache.py`.

- [ ] **Step 3: Run manifest tests**

```bash
python -m pytest tests/test_octowiz_cache.py::TestManifestReadWrite -v
```

Expected: 4 tests PASSED.

- [ ] **Step 4: Run full test suite**

```bash
python -m pytest tests/test_octowiz_cache.py -v
```

Expected: all tests PASSED.

- [ ] **Step 5: Commit**

```bash
git add tests/test_octowiz_cache.py
git commit -m "test: add manifest read/write and bundle atomic-write tests"
```

---

### Task 3: CLI — build, get, status, refresh, clear

**Files:**
- Create: `octowiz_cache_cli.py`

The CLI is a thin argparse shell over `octowiz_cache`. The module itself stays import-safe.

- [ ] **Step 1: Create octowiz_cache_cli.py**

```python
#!/usr/bin/env python3
"""octowiz-cache CLI — build, get, status, refresh, and clear doctrine bundles."""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

import octowiz_cache


def _cache_dir(args: argparse.Namespace) -> Path:
    return Path(
        getattr(args, "cache_dir", None)
        or os.getenv("OCTOWIZ_CACHE_DIR", octowiz_cache.DEFAULT_CACHE_DIR)
    )


def _ttl(args: argparse.Namespace) -> int:
    return getattr(args, "ttl_seconds", None) or int(
        os.getenv("OCTOWIZ_CACHE_TTL_SECONDS", octowiz_cache.DEFAULT_TTL_SECONDS)
    )


def cmd_get(args: argparse.Namespace) -> int:
    bypass = (
        getattr(args, "refresh_memory", False)
        or os.getenv("OCTOWIZ_CACHE_BYPASS") == "1"
        or os.getenv("OCTOWIZ_CACHE_REFRESH") == "1"
    )
    try:
        content = octowiz_cache.get_bundle(
            role=args.role,
            namespace=args.namespace,
            cache_dir=_cache_dir(args),
            ttl_seconds=_ttl(args),
            refresh=bypass,
        )
        print(content, end="")
        return 0
    except KeyError as exc:
        print(f"[octowiz-cache] ERROR: {exc}", file=sys.stderr)
        return 1
    except RuntimeError as exc:
        print(f"[octowiz-cache] ERROR: {exc}", file=sys.stderr)
        return 1


def cmd_build(args: argparse.Namespace) -> int:
    roles = (
        list(octowiz_cache.ROLE_MEMORY_KEYS.keys())
        if getattr(args, "all", False)
        else [args.role]
    )
    failures: list[tuple[str, str]] = []
    for role in roles:
        try:
            octowiz_cache.get_bundle(
                role=role,
                namespace=args.namespace,
                cache_dir=_cache_dir(args),
                ttl_seconds=_ttl(args),
                refresh=True,
            )
            print(f"[octowiz-cache] built: {role}", file=sys.stderr)
        except Exception as exc:
            failures.append((role, str(exc)))
            print(f"[octowiz-cache] FAILED: {role} — {exc}", file=sys.stderr)
    if failures:
        print(
            f"\n[octowiz-cache] {len(roles) - len(failures)}/{len(roles)} roles built successfully.",
            file=sys.stderr,
        )
        return 1
    return 0


def cmd_status(args: argparse.Namespace) -> int:
    cache_dir = _cache_dir(args)
    ttl = _ttl(args)
    ns_dir = cache_dir / "namespaces" / args.namespace
    manifest = octowiz_cache._read_manifest(ns_dir)
    now = time.time()
    for role in octowiz_cache.ROLE_MEMORY_KEYS:
        if manifest is None or role not in manifest.get("roles", {}):
            print(f"{role:15s} ✗ missing")
            continue
        updated_at = manifest.get("updated_at", 0)
        age_s = int(now - updated_at)
        age_str = f"{age_s // 60}m ago" if age_s < 3600 else f"{age_s // 3600}h ago"
        fresh = octowiz_cache.manifest_is_fresh(manifest, ttl)
        symbol = "✓ fresh" if fresh else "✗ stale"
        print(f"{role:15s} {symbol} ({age_str})")
    return 0


def cmd_refresh(args: argparse.Namespace) -> int:
    args.all = True
    return cmd_build(args)


def cmd_clear(args: argparse.Namespace) -> int:
    import shutil

    cache_dir = _cache_dir(args)
    if getattr(args, "all_namespaces", False):
        if cache_dir.exists():
            shutil.rmtree(cache_dir)
            print(f"[octowiz-cache] cleared entire cache at {cache_dir}", file=sys.stderr)
    else:
        ns_dir = cache_dir / "namespaces" / args.namespace
        if ns_dir.exists():
            shutil.rmtree(ns_dir)
            print(f"[octowiz-cache] cleared namespace '{args.namespace}' at {ns_dir}", file=sys.stderr)
        else:
            print(f"[octowiz-cache] nothing to clear for namespace '{args.namespace}'", file=sys.stderr)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(prog="octowiz-cache", description="Manage Octowiz doctrine bundle cache.")
    parser.add_argument("--namespace", default=os.getenv("OCTOWIZ_NAMESPACE", "allspark"))
    parser.add_argument("--ttl-seconds", type=int, dest="ttl_seconds")
    parser.add_argument("--cache-dir", dest="cache_dir")

    sub = parser.add_subparsers(dest="command", required=True)

    p_get = sub.add_parser("get", help="Print cached bundle to stdout (rebuild if stale).")
    p_get.add_argument("--role", required=True, choices=list(octowiz_cache.ROLE_MEMORY_KEYS))
    p_get.add_argument("--refresh-memory", action="store_true", dest="refresh_memory")

    p_build = sub.add_parser("build", help="Build and cache a bundle.")
    grp = p_build.add_mutually_exclusive_group(required=True)
    grp.add_argument("--role", choices=list(octowiz_cache.ROLE_MEMORY_KEYS))
    grp.add_argument("--all", action="store_true")

    sub.add_parser("status", help="Show freshness of cached bundles.")

    sub.add_parser("refresh", help="Force-rebuild all bundles.")

    p_clear = sub.add_parser("clear", help="Delete cached bundles.")
    p_clear.add_argument("--all-namespaces", action="store_true", dest="all_namespaces")

    args = parser.parse_args()
    dispatch = {
        "get": cmd_get,
        "build": cmd_build,
        "status": cmd_status,
        "refresh": cmd_refresh,
        "clear": cmd_clear,
    }
    return dispatch[args.command](args)


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Smoke-test CLI help**

```bash
python octowiz_cache_cli.py --help
python octowiz_cache_cli.py status --help
python octowiz_cache_cli.py build --help
```

Expected: help text prints, no traceback.

- [ ] **Step 3: Smoke-test status with empty cache**

```bash
python octowiz_cache_cli.py status
```

Expected: 5 lines, each ending in `✗ missing`.

- [ ] **Step 4: Commit**

```bash
git add octowiz_cache_cli.py
git commit -m "feat: add octowiz-cache CLI (build, get, status, refresh, clear)"
```

---

### Task 4: pyproject.toml — packaging and console script

**Files:**
- Create: `pyproject.toml`

- [ ] **Step 1: Create pyproject.toml**

```toml
[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.backends.legacy:build"

[project]
name = "octowiz"
version = "0.1.0"
description = "Memory stack and coordinator skill for AI-assisted development in Claude Code"
readme = "README.md"
license = { text = "MIT" }
requires-python = ">=3.8"
dependencies = ["httpx>=0.27.0"]

[project.scripts]
octowiz-cache = "octowiz_cache_cli:main"
```

- [ ] **Step 2: Install in editable mode**

```bash
pip install -e .
```

Expected: installs without error. `octowiz-cache` becomes available in the active environment.

- [ ] **Step 3: Verify console script is callable**

```bash
octowiz-cache --help
octowiz-cache status
```

Expected: help text prints, then 5 `✗ missing` lines.

- [ ] **Step 4: Run full test suite to confirm nothing broken**

```bash
python -m pytest tests/ -v
```

Expected: all tests PASSED.

- [ ] **Step 5: Commit**

```bash
git add pyproject.toml
git commit -m "feat: add pyproject.toml with octowiz-cache console script entry point"
```

---

### Task 5: Update skill.md — replace curl with octowiz-cache

**Files:**
- Modify: `skills/octowiz-workflow/skill.md`

- [ ] **Step 1: Read the current Step 2 in skills/octowiz-workflow/skill.md**

Open `skills/octowiz-workflow/skill.md` and locate `## Step 2 — Fetch memories from LiteLLM`.

- [ ] **Step 2: Replace the Step 2 block**

Replace the entire `## Step 2 — Fetch memories from LiteLLM` section with:

```markdown
## Step 2 — Load routing doctrine

Run:

```bash
octowiz-cache get --role routing --namespace "${OCTOWIZ_NAMESPACE:-allspark}"
```

If `octowiz-cache` is not installed or exits non-zero, fall back to:

```bash
curl -s "$LITELLM_BASE_URL/v1/memory/team%3A${OCTOWIZ_NAMESPACE:-allspark}%3Aconfig%3Aretrieval-contract" \
  -H "Authorization: Bearer ${LITELLM_ADMIN_API_KEY:-$LITELLM_API_KEY}" 2>/dev/null
```

If both fail, or if `LITELLM_BASE_URL` and API key env vars are not set, tell the developer:

> "Set LITELLM_BASE_URL and LITELLM_ADMIN_API_KEY (or LITELLM_API_KEY) in
> ~/.claude/settings.json to enable memory-backed doctrine. See the octowiz README
> for setup instructions. Continuing with built-in workflow."

Then continue using the built-in routing below — do not stop.

After the user chooses a workflow option, load the corresponding role bundle before
appending fresh project state:

- Options A or B → `octowiz-cache get --role planner --namespace "${OCTOWIZ_NAMESPACE:-allspark}"`
- Option C → `octowiz-cache get --role implementer --namespace "${OCTOWIZ_NAMESPACE:-allspark}"`
- Option D → `octowiz-cache get --role reviewer --namespace "${OCTOWIZ_NAMESPACE:-allspark}"`

Prepend the bundle content before fresh git status, open issues, and user request context.
Do not add `2>/dev/null` — let stderr surface to the developer.
```

- [ ] **Step 3: Verify the skill file is still valid**

```bash
python -c "
content = open('skills/octowiz-workflow/skill.md').read()
assert content.startswith('---'), 'missing frontmatter'
assert 'octowiz-cache get --role routing' in content, 'cache call missing'
assert 'curl -s' in content, 'curl fallback missing'
assert '2>/dev/null' not in content.split('curl fallback')[0], 'stderr suppressed on primary call'
print('skill.md looks valid')
"
```

Expected: `skill.md looks valid`

- [ ] **Step 4: Run full test suite one final time**

```bash
python -m pytest tests/ -v
```

Expected: all tests PASSED.

- [ ] **Step 5: Commit**

```bash
git add skills/octowiz-workflow/skill.md
git commit -m "feat: update /octowiz skill to use octowiz-cache, load role bundles per workflow option"
```

---

## Self-Review

**Spec coverage:**

| PRD requirement | Task |
|---|---|
| `hash_memory`, `hash_bundle`, `render_bundle`, `manifest_is_fresh` | Task 1 |
| `get_litellm_client`, `fetch_memory`, `fetch_role_memories` | Task 1 |
| `get_bundle` pipeline (stale-serve, atomic writes, bypass) | Task 1 |
| `ROLE_MEMORY_KEYS` with corrected `team:` prefix for routing | Task 1 |
| `{namespace}` via `.replace()` | Task 1 |
| `agent:*` keys namespace-agnostic (no `{namespace}`) | Task 1 |
| Concurrent writes atomic via `os.replace()` | Task 1 |
| Stale cache serves with stderr warning | Task 1 |
| 404 raises with key name | Task 1 |
| All 10 tests (mocked, no real network) | Tasks 1–2 |
| Manifest read/write roundtrip tests | Task 2 |
| CLI: build, get, status, refresh, clear | Task 3 |
| `build --all` continues on failure, summarizes | Task 3 |
| `clear` scoped to namespace, `--all-namespaces` flag | Task 3 |
| `status` one-line per role, no network call | Task 3 |
| `--json` deferred | Task 3 (not present) |
| `pyproject.toml` with `[project.scripts]` | Task 4 |
| `octowiz-cache` console script installable via `pip install -e .` | Task 4 |
| Skill Step 2 replaced with `octowiz-cache get --role routing` | Task 5 |
| `curl` fallback kept | Task 5 |
| stderr not suppressed (`2>/dev/null` absent from primary call) | Task 5 |
| Role bundle loaded after A/B/C/D selection | Task 5 |

All requirements covered. No gaps.

**Placeholder scan:** No TBDs, no "implement later", no steps without code. ✓

**Type consistency:** `hash_memory(memory)`, `hash_bundle(role, memories)`, `render_bundle(role, memories)`, `manifest_is_fresh(manifest, ttl_seconds)`, `get_bundle(role, namespace, cache_dir, ttl_seconds, refresh)` — consistent across module, tests, and CLI. `fetch_memory(client, key)`, `fetch_role_memories(client, role, namespace)` — consistent. `_write_manifest(ns_dir, manifest)`, `_read_manifest(ns_dir)`, `_write_bundle(ns_dir, role, bundle_hash, content)`, `_read_bundle(ns_dir, role, bundle_hash)` — consistent between module and tests. ✓
