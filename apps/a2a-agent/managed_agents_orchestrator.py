"""Runtime client for an already-created Octowiz Managed Agents coordinator."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Optional


def _get(value: Any, name: str, default: Any = None) -> Any:
    if isinstance(value, dict):
        return value.get(name, default)
    return getattr(value, name, default)


def _plain_usage(value: Any) -> Dict[str, int]:
    fields = (
        "input_tokens",
        "output_tokens",
        "cache_creation_input_tokens",
        "cache_read_input_tokens",
    )
    result: Dict[str, int] = {}
    for name in fields:
        amount = _get(value, name)
        if isinstance(amount, int):
            result[name] = amount
    return result


def _message_text(event: Any) -> str:
    parts: List[str] = []
    for block in _get(event, "content", []) or []:
        if _get(block, "type") == "text":
            parts.append(str(_get(block, "text", "")))
    return "".join(parts)


@dataclass
class ManagedAgentsResult:
    session_id: str
    output: str = ""
    thread_events: List[Dict[str, Any]] = field(default_factory=list)
    usage_by_thread: Dict[str, Dict[str, int]] = field(default_factory=dict)

    @property
    def usage(self) -> Dict[str, int]:
        totals: Dict[str, int] = {}
        for usage in self.usage_by_thread.values():
            for name, amount in usage.items():
                totals[name] = totals.get(name, 0) + amount
        return totals


class ManagedAgentsOrchestrator:
    """Create one coordinator session per run and consume its live event stream."""

    def __init__(self, client: Any):
        self._client = client

    def run(
        self,
        *,
        task: str,
        execution: Dict[str, Any],
        capability: Optional[Dict[str, str]] = None,
        resources: Optional[List[Dict[str, Any]]] = None,
        title: Optional[str] = None,
    ) -> ManagedAgentsResult:
        agent: Any = execution["coordinatorAgentId"]
        if execution.get("coordinatorAgentVersion") is not None:
            agent = {
                "type": "agent",
                "id": execution["coordinatorAgentId"],
                "version": execution["coordinatorAgentVersion"],
            }
        metadata = {
            "system": "octowiz",
            "maxAgents": str(execution["maxAgents"]),
        }
        if capability:
            metadata["capability"] = str(capability.get("name") or "")[:512]
            metadata["provider"] = str(capability.get("provider") or "")[:512]
        session = self._client.beta.sessions.create(
            agent=agent,
            environment_id=execution["environmentId"],
            title=title or "Octowiz coordinated run",
            resources=resources or [],
            metadata=metadata,
        )
        result = ManagedAgentsResult(session_id=session.id)
        prompt = self._build_task_prompt(task, execution, capability)

        with self._client.beta.sessions.stream(session_id=session.id) as stream:
            self._client.beta.sessions.events.send(
                session_id=session.id,
                events=[{
                    "type": "user.message",
                    "content": [{"type": "text", "text": prompt}],
                }],
            )
            self._consume(stream, result)
        return result

    @staticmethod
    def _build_task_prompt(
        task: str,
        execution: Dict[str, Any],
        capability: Optional[Dict[str, str]],
    ) -> str:
        route = ""
        if capability:
            route = (
                f"Requested route: {capability.get('name', '')} -> "
                f"{capability.get('provider', '')}:{capability.get('command', '')} "
                f"({capability.get('role', 'worker')}).\n"
            )
        return (
            f"{route}"
            f"Use at most {execution['maxAgents']} workers.\n"
            f"Independent scope: {execution['scope']}\n"
            f"Verification: {execution['verification']}\n"
            f"Writes: {str(execution['writes']).lower()}; "
            f"isolation: {execution['isolation']}.\n\n"
            f"Task:\n{task}"
        )

    def _consume(self, stream: Iterable[Any], result: ManagedAgentsResult) -> None:
        coordinator_messages: List[str] = []
        for event in stream:
            event_type = str(_get(event, "type", ""))
            thread_id = str(
                _get(event, "thread_id")
                or _get(event, "agent_id")
                or "coordinator"
            )
            if event_type == "agent.message":
                text = _message_text(event)
                if text and thread_id == "coordinator":
                    coordinator_messages.append(text)
            if event_type in {
                "thread_created",
                "thread_message_sent",
                "thread_message_received",
                "agent.thread_created",
                "agent.thread_message_sent",
                "agent.thread_message_received",
            }:
                result.thread_events.append({
                    "type": event_type,
                    "threadId": thread_id,
                    "eventId": str(_get(event, "id", "")),
                })
            usage = _plain_usage(_get(event, "usage"))
            if usage:
                result.usage_by_thread[thread_id] = usage
            model_usage = _plain_usage(_get(event, "model_usage"))
            if model_usage:
                current = result.usage_by_thread.setdefault(thread_id, {})
                for name, amount in model_usage.items():
                    current[name] = current.get(name, 0) + amount
            if event_type == "session.error":
                message = _get(event, "message") or _get(event, "error") or "Managed Agents session failed"
                raise RuntimeError(str(message))
            if event_type in {"session.status_idle", "session.status_terminated"}:
                break
        result.output = coordinator_messages[-1] if coordinator_messages else ""
