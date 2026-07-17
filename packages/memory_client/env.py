"""Environment detection, state I/O, and repository profiling for Octowiz."""

from __future__ import annotations

import json
import os
import subprocess
import uuid
import urllib.parse
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

MACHINE_STATE_DIR = Path.home() / ".octowiz"
MACHINE_STATE_PATH = MACHINE_STATE_DIR / "machine-state.json"
OCTOWIZ_DIR = ".octowiz"
SETUP_STATE_FILENAME = "setup-state.json"
ONBOARDING_FILENAME = "ONBOARDING.md"
PLUGINS_CACHE_BASE = Path.home() / ".claude" / "plugins" / "cache"
REQUIRED_PLUGINS = ["mattpocock-skills"]
OPTIONAL_PLUGINS = ["antfu-skills"]
CACHE_TTL_HOURS = 24


@dataclass
class MachineState:
    first_seen: str = ""
    plugins: Dict[str, str] = field(default_factory=dict)
    litellm: Dict[str, Optional[str]] = field(default_factory=lambda: {
        "routing_verified_at": None,
        "planner_verified_at": None,
        "implementer_verified_at": None,
        "reviewer_verified_at": None,
    })
    dismissed_checks: Dict[str, List[str]] = field(default_factory=dict)


@dataclass
class RepoState:
    created_at: str = ""
    mattpocock_setup: bool = False
    antfu_relevant: Optional[bool] = None
    antfu_setup: bool = False
    antfu_deferred: bool = False
    project_id: Optional[str] = None


@dataclass
class RepoScan:
    agent_file: Optional[str]
    mattpocock_setup_files: bool
    stack: str
    has_context_md: bool
    has_adr: bool
    has_github_remote: bool


@dataclass
class CheckResult:
    hard_gaps: List[str]
    advisory_gaps: List[str]
    machine_state_absent: bool
    repo_state_absent: bool


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load_machine_state(path: Path = MACHINE_STATE_PATH) -> Optional[MachineState]:
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text())
    except (json.JSONDecodeError, OSError):
        return None
    return MachineState(
        first_seen=data.get("first_seen", ""),
        plugins=data.get("plugins", {}),
        litellm=data.get("litellm") or MachineState().litellm,
        dismissed_checks=data.get("dismissed_checks", {}),
    )


def save_machine_state(state: MachineState, path: Path = MACHINE_STATE_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(asdict(state), indent=2))


def init_machine_state(path: Path = MACHINE_STATE_PATH) -> MachineState:
    existing = load_machine_state(path)
    if existing is not None:
        return existing
    state = MachineState(first_seen=_now_iso())
    save_machine_state(state, path)
    return state


def load_repo_state(cwd: Path) -> Optional[RepoState]:
    path = cwd / OCTOWIZ_DIR / SETUP_STATE_FILENAME
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text())
    except (json.JSONDecodeError, OSError):
        return None
    return RepoState(
        created_at=data.get("created_at", ""),
        mattpocock_setup=data.get("mattpocock_setup", False),
        antfu_relevant=data.get("antfu_relevant"),
        antfu_setup=data.get("antfu_setup", False),
        antfu_deferred=data.get("antfu_deferred", False),
        project_id=data.get("project_id"),
    )


def save_repo_state(state: RepoState, cwd: Path) -> None:
    path = cwd / OCTOWIZ_DIR / SETUP_STATE_FILENAME
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(asdict(state), indent=2))


def init_repo_state(cwd: Path) -> RepoState:
    existing = load_repo_state(cwd)
    if existing is not None:
        return existing
    state = RepoState(created_at=_now_iso())
    save_repo_state(state, cwd)
    return state


def detect_plugin(plugin_id: str, plugins_base: Path = PLUGINS_CACHE_BASE) -> bool:
    if not plugins_base.exists():
        return False
    return any(path.exists() for path in plugins_base.glob(f"*/{plugin_id}"))


def detect_all_plugins(
    plugin_ids: List[str] = REQUIRED_PLUGINS,
    plugins_base: Path = PLUGINS_CACHE_BASE,
) -> Dict[str, bool]:
    return {plugin_id: detect_plugin(plugin_id, plugins_base) for plugin_id in plugin_ids}


def _detect_agent_file(cwd: Path) -> Optional[str]:
    for name in ("AGENTS.md", "CLAUDE.md", "GEMINI.md"):
        if (cwd / name).exists():
            return name
    return None


def _has_mattpocock_setup_files(cwd: Path, has_github_remote: bool) -> bool:
    required = [
        cwd / "docs" / "agents" / "issue-tracker.md",
        cwd / "docs" / "agents" / "domain.md",
    ]
    if has_github_remote:
        required.append(cwd / "docs" / "agents" / "triage-labels.md")
    return all(path.is_file() for path in required)


def _detect_stack(cwd: Path) -> str:
    package_path = cwd / "package.json"
    has_python = (cwd / "pyproject.toml").exists() or (cwd / "setup.py").exists()
    if not package_path.exists():
        return "python" if has_python else "empty"
    try:
        package = json.loads(package_path.read_text())
    except Exception:
        return "polyglot" if has_python else "generic_js"
    dependencies = {
        **(package.get("dependencies") or {}),
        **(package.get("devDependencies") or {}),
    }
    keys = set(dependencies)
    js_stack = "ts_vue" if keys & {"vue", "nuxt", "vite", "vitest", "unocss", "@vueuse/core"} else (
        "react" if "react" in keys else "generic_js"
    )
    return "polyglot" if has_python else js_stack


def _has_github_remote(cwd: Path) -> bool:
    try:
        result = subprocess.run(
            ["git", "remote", "-v"], cwd=cwd, capture_output=True, text=True, timeout=5
        )
        return "github.com" in result.stdout
    except Exception:
        return False


def scan_repo(cwd: Path) -> RepoScan:
    agent_file = _detect_agent_file(cwd)
    has_github_remote = _has_github_remote(cwd)
    return RepoScan(
        agent_file=agent_file,
        mattpocock_setup_files=_has_mattpocock_setup_files(cwd, has_github_remote),
        stack=_detect_stack(cwd),
        has_context_md=(cwd / "CONTEXT.md").exists(),
        has_adr=(cwd / "docs" / "adr").is_dir(),
        has_github_remote=has_github_remote,
    )


def _litellm_env_ok() -> bool:
    return bool(
        os.environ.get("LITELLM_BASE_URL")
        and (os.environ.get("LITELLM_ADMIN_API_KEY") or os.environ.get("LITELLM_API_KEY"))
    )


def _litellm_cache_ok(machine_state: Optional[MachineState]) -> bool:
    if machine_state is None or not isinstance(machine_state.litellm, dict):
        return False
    timestamp = machine_state.litellm.get("routing_verified_at")
    if not isinstance(timestamp, str) or not timestamp:
        return False
    try:
        verified_at = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
        age = datetime.now(timezone.utc) - verified_at
        return age.total_seconds() < CACHE_TTL_HOURS * 3600
    except (ValueError, TypeError):
        return False


def _antfu_gap(scan: RepoScan, repo_state: Optional[RepoState]) -> bool:
    """Compatibility helper: True means Antfu could be useful, never blocking."""
    if scan.stack not in {"ts_vue", "polyglot"}:
        return False
    return repo_state is None or not repo_state.antfu_setup


def _repo_key(cwd: Path) -> str:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
    except Exception:
        pass
    return str(cwd.resolve())


def _get_dismissed_checks(cwd: Path, state: Optional[MachineState]) -> List[str]:
    if state is None:
        return []
    return list(state.dismissed_checks.get(_repo_key(cwd), []))


def run_live_check(
    cwd: Path,
    machine_state_path: Path = MACHINE_STATE_PATH,
    plugins_base: Path = PLUGINS_CACHE_BASE,
) -> CheckResult:
    machine_state = load_machine_state(machine_state_path)
    repo_state = load_repo_state(cwd)
    dismissed = _get_dismissed_checks(cwd, machine_state)
    hard_gaps: List[str] = []
    advisory_gaps: List[str] = []

    if not detect_plugin("mattpocock-skills", plugins_base):
        if "plugin_mattpocock-skills" not in dismissed:
            hard_gaps.append("plugin_mattpocock-skills")

    if not _litellm_env_ok() and "litellm_env" not in dismissed:
        hard_gaps.append("litellm_env")
    if not _litellm_cache_ok(machine_state) and "litellm_cache" not in dismissed:
        hard_gaps.append("litellm_cache")

    scan = scan_repo(cwd)
    if scan.agent_file is None and "agent_file" not in dismissed:
        advisory_gaps.append("agent_file")
    if scan.agent_file is not None and not scan.mattpocock_setup_files:
        if "mattpo_skills_setup" not in dismissed:
            advisory_gaps.append("mattpo_skills_setup")
    if _antfu_gap(scan, repo_state) and "antfu_optional" not in dismissed:
        advisory_gaps.append("antfu_optional")

    return CheckResult(
        hard_gaps=hard_gaps,
        advisory_gaps=advisory_gaps,
        machine_state_absent=machine_state is None,
        repo_state_absent=repo_state is None,
    )


def seed_project_namespace(project_id: str, client: "httpx.Client") -> None:
    namespace = f"project:{project_id}:octowiz"
    config_key = f"{namespace}:config"
    rules_key = f"{namespace}:rules"

    def read(key: str):
        response = client.get(f"/v1/memory/{urllib.parse.quote(key, safe='')}")
        if response.status_code == 404:
            return None
        response.raise_for_status()
        data = response.json()
        return data.get("value") or data.get("memory")

    def write(key: str, value: str) -> None:
        response = client.put(
            f"/v1/memory/{urllib.parse.quote(key, safe='')}",
            json={"value": value, "metadata": {}},
        )
        response.raise_for_status()

    if read(config_key) is None:
        write(config_key, json.dumps({"namespace": namespace, "created_at": _now_iso()}))
    if read(rules_key) is None:
        write(rules_key, json.dumps([]))


def derive_project_id(cwd: Path) -> str:
    try:
        result = subprocess.run(
            ["git", "remote", "get-url", "origin"],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0:
            url = result.stdout.strip().rstrip("/")
            if url.endswith(".git"):
                url = url[:-4]
            if ":" in url and not url.startswith("http"):
                url = url.split(":", 1)[1]
            parts = [part for part in url.replace("\\", "/").split("/") if part]
            if parts:
                return "-".join(parts[-2:]).lower()
    except Exception:
        pass
    return uuid.uuid4().hex


def dismiss_check(
    check_id: str,
    cwd: Path,
    machine_state_path: Path = MACHINE_STATE_PATH,
) -> None:
    state = load_machine_state(machine_state_path) or MachineState(first_seen=_now_iso())
    repo_root = _repo_key(cwd)
    checks = list(state.dismissed_checks.get(repo_root, []))
    if check_id not in checks:
        checks.append(check_id)
    state.dismissed_checks[repo_root] = checks
    save_machine_state(state, machine_state_path)
