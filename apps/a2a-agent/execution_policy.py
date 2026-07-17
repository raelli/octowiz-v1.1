"""Validate execution policies at the Python defence boundary."""
from typing import Any, Dict, Optional

_MODELS = {"fable", "sonnet", "haiku"}
_MAX_AGENTS = 16


def _valid_model(value: Any) -> bool:
    return isinstance(value, str) and (
        value in _MODELS or value.startswith("claude-")
    )


def _advisor_default() -> Dict[str, Any]:
    return {
        "pattern": "advisor",
        "executorModel": "sonnet",
        "advisorModel": "fable",
        "maxAdvisorCalls": 1,
        "effort": "high",
    }


def normalize_execution_policy(raw: Optional[Any]) -> Dict[str, Any]:
    """Return a complete policy or raise ValueError for supplied invalid data."""
    if raw is None:
        return _advisor_default()
    if not isinstance(raw, dict):
        raise ValueError("execution policy must be an object")

    pattern = raw.get("pattern")
    issues = []
    if pattern == "advisor":
        if not _valid_model(raw.get("executorModel")):
            issues.append("execution.executorModel is invalid")
        if not _valid_model(raw.get("advisorModel")):
            issues.append("execution.advisorModel is invalid")
        calls = raw.get("maxAdvisorCalls")
        if not isinstance(calls, int) or isinstance(calls, bool) or not 1 <= calls <= 2:
            issues.append("execution.maxAdvisorCalls must be between 1 and 2")
        if raw.get("effort") != "high":
            issues.append("execution.effort must be high for advisor mode")
    elif pattern == "workflow":
        if raw.get("partitionable") is not True:
            issues.append("execution.partitionable must be true")
        if not isinstance(raw.get("scope"), str) or not raw["scope"].strip():
            issues.append("execution.scope is required")
        if (
            not isinstance(raw.get("verification"), str)
            or not raw["verification"].strip()
        ):
            issues.append("execution.verification is required")
        agents = raw.get("maxAgents")
        if (
            not isinstance(agents, int)
            or isinstance(agents, bool)
            or not 1 <= agents <= _MAX_AGENTS
        ):
            issues.append("execution.maxAgents must be between 1 and 16")
        for field in ("plannerModel", "workerModel", "synthesizerModel"):
            if not _valid_model(raw.get(field)):
                issues.append(f"execution.{field} is invalid")
        if raw.get("effort") != "ultracode":
            issues.append("execution.effort must be ultracode")
        if not isinstance(raw.get("writes"), bool):
            issues.append("execution.writes must be a boolean")
        if raw.get("isolation") not in {"none", "worktree"}:
            issues.append("execution.isolation must be none or worktree")
        if raw.get("writes") is True and raw.get("isolation") != "worktree":
            issues.append("writing workflows require execution.isolation=worktree")
        budget = raw.get("budgetTokens")
        if budget is not None and (
            not isinstance(budget, int) or isinstance(budget, bool) or budget < 1
        ):
            issues.append("execution.budgetTokens must be a positive integer")
    else:
        issues.append("execution.pattern must be advisor or workflow")

    if issues:
        raise ValueError("; ".join(issues))
    return dict(raw)
