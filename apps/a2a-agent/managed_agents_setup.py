"""One-time setup for the persisted Octowiz CMA coordinator and worker team."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

from managed_agents_config import write_team_config

_ROOT = Path(__file__).resolve().parents[2]
_DEFAULT_REGISTRY = _ROOT / "skills" / "registry.json"


def load_role_manifest(registry_path: Path = _DEFAULT_REGISTRY) -> Dict[str, Any]:
    registry = json.loads(registry_path.read_text(encoding="utf-8"))
    roles: Dict[str, List[Dict[str, str]]] = {"coordinator": [], "worker": []}
    for capability, definition in registry["capabilities"].items():
        for resolver in definition["resolvers"]:
            role = resolver.get("role", "worker")
            roles[role].append({
                "capability": capability,
                "provider": resolver["provider"],
                "command": resolver["command"],
            })
    providers = {
        name: definition.get("roles", ["worker"])
        for name, definition in registry["providers"].items()
    }
    return {"roles": roles, "providers": providers}


def _role_lines(items: Iterable[Dict[str, str]]) -> str:
    return "\n".join(
        f"- {item['capability']}: {item['provider']}:{item['command']}"
        for item in items
    )


def build_worker_prompt(manifest: Dict[str, Any]) -> str:
    return (
        "You are an Octowiz execution worker. You receive one narrow, independent "
        "engineering task from a coordinator. Use the attached Matt Pocock skills "
        "for engineering methodology, Antfu skills only when repository evidence "
        "shows the Vue/Nuxt/Vite/Vitest/pnpm/UnoCSS ecosystem, and Octowiz-native "
        "skills for policy, verification, and evidence. Stay within the delegated "
        "scope, return concise evidence, and always finish by calling submit_result.\n\n"
        "Worker-owned capability routes:\n"
        f"{_role_lines(manifest['roles']['worker'])}"
    )


def build_coordinator_prompt(manifest: Dict[str, Any]) -> str:
    return (
        "You are the Octowiz CMA coordinator. Plan and synthesize; do not perform "
        "mechanical repository work yourself. Break the request into independent, "
        "bounded tasks and delegate worker-owned capabilities with create_agent. "
        "After spawning, always call wait_for_agents before drawing conclusions. "
        "Use send_to_agent for focused follow-up, replace workers that return only "
        "infrastructure errors, enforce human gates, and synthesize evidence into "
        "one final answer. The sole roster worker owns Matt Pocock implementation "
        "methods, optional Antfu stack guidance, and Octowiz-native execution checks.\n\n"
        "Coordinator-owned capability routes:\n"
        f"{_role_lines(manifest['roles']['coordinator'])}"
    )


def _skills_for_role(
    skill_refs: Dict[str, List[Dict[str, Any]]],
    manifest: Dict[str, Any],
    role: str,
) -> List[Dict[str, Any]]:
    selected: List[Dict[str, Any]] = []
    for provider, refs in skill_refs.items():
        if role in manifest["providers"].get(provider, []):
            selected.extend(refs)
    return selected


def create_team(
    client: Any,
    *,
    environment_id: str,
    coordinator_model: str,
    worker_model: str,
    skill_refs: Optional[Dict[str, List[Dict[str, Any]]]] = None,
    registry_path: Path = _DEFAULT_REGISTRY,
    config_path: Optional[Path] = None,
) -> Dict[str, Any]:
    """Create persistent agents once and store their non-secret references."""
    manifest = load_role_manifest(registry_path)
    refs = skill_refs or {}
    worker = client.beta.agents.create(
        name="octowiz-execution-worker",
        description="Executes narrow engineering tasks delegated by Octowiz.",
        model=worker_model,
        system=build_worker_prompt(manifest),
        tools=[{
            "type": "agent_toolset_20260401",
            "default_config": {"enabled": True},
        }],
        skills=_skills_for_role(refs, manifest, "worker"),
        metadata={"system": "octowiz", "role": "worker"},
    )
    coordinator = client.beta.agents.create(
        name="octowiz-coordinator",
        description="Plans, delegates, verifies, and synthesizes Octowiz work.",
        model=coordinator_model,
        system=build_coordinator_prompt(manifest),
        multiagent={
            "type": "coordinator",
            "agents": [{"type": "agent", "id": worker.id}],
        },
        skills=_skills_for_role(refs, manifest, "coordinator"),
        metadata={"system": "octowiz", "role": "coordinator"},
    )
    config = {
        "schemaVersion": 1,
        "environmentId": environment_id,
        "coordinatorAgentId": coordinator.id,
        "coordinatorAgentVersion": coordinator.version,
        "workerAgentId": worker.id,
        "workerAgentVersion": worker.version,
        "coordinatorModel": coordinator_model,
        "workerModel": worker_model,
        "providers": manifest["providers"],
    }
    write_team_config(config, config_path)
    return config


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Create the persistent Octowiz CMA team")
    parser.add_argument("--environment-id", required=True)
    parser.add_argument("--coordinator-model", required=True)
    parser.add_argument("--worker-model", required=True)
    parser.add_argument(
        "--skills-json",
        type=Path,
        help="JSON mapping provider IDs to hosted Managed Agents skill references",
    )
    parser.add_argument("--config", type=Path)
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    skill_refs = {}
    if args.skills_json:
        skill_refs = json.loads(args.skills_json.read_text(encoding="utf-8"))
    import anthropic

    config = create_team(
        anthropic.Anthropic(),
        environment_id=args.environment_id,
        coordinator_model=args.coordinator_model,
        worker_model=args.worker_model,
        skill_refs=skill_refs,
        config_path=args.config,
    )
    print(json.dumps(config, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
