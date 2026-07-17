"""Machine-local configuration for persistent Octowiz Managed Agents."""
from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any, Dict, Optional


def default_config_path() -> Path:
    configured = os.environ.get("OCTOWIZ_CMA_CONFIG", "").strip()
    if configured:
        return Path(configured).expanduser()
    return Path.home() / ".cache" / "octowiz" / "managed-agents.json"


def load_team_config(path: Optional[Path] = None) -> Dict[str, Any]:
    target = path or default_config_path()
    with target.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    required = ("environmentId", "coordinatorAgentId", "workerAgentId")
    missing = [name for name in required if not data.get(name)]
    if missing:
        raise ValueError(f"managed-agents config missing: {', '.join(missing)}")
    return data


def write_team_config(config: Dict[str, Any], path: Optional[Path] = None) -> Path:
    target = path or default_config_path()
    target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    payload = json.dumps(config, indent=2, sort_keys=True) + "\n"
    fd, temp_name = tempfile.mkstemp(prefix=".managed-agents-", dir=str(target.parent))
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, target)
    except Exception:
        try:
            os.unlink(temp_name)
        except FileNotFoundError:
            pass
        raise
    return target
