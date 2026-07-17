"""Tests for persisted CMA setup and Managed Agents event aggregation."""
import json
import stat
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
APP = HERE.parent
sys.path.insert(0, str(APP))

from capabilities.dispatch import handle_dispatch
from managed_agents_config import load_team_config
from managed_agents_orchestrator import ManagedAgentsOrchestrator
from managed_agents_setup import create_team, load_role_manifest


class _AgentAPI:
    def __init__(self):
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        index = len(self.calls)
        return SimpleNamespace(id=f"agent_{index}", version=index)


class _Stream:
    def __init__(self, events):
        self.events = events

    def __enter__(self):
        return iter(self.events)

    def __exit__(self, *_args):
        return False


class _SessionAPI:
    def __init__(self, events):
        self.create_calls = []
        self.send_calls = []
        self._events = events
        self.events = SimpleNamespace(send=self._send)

    def create(self, **kwargs):
        self.create_calls.append(kwargs)
        return SimpleNamespace(id="sesn_1")

    def stream(self, **kwargs):
        self.stream_args = kwargs
        return _Stream(self._events)

    def _send(self, **kwargs):
        self.send_calls.append(kwargs)


class TestManagedAgentsSetup(unittest.TestCase):
    def test_manifest_has_explicit_provider_roles(self):
        manifest = load_role_manifest()
        self.assertEqual(manifest["providers"]["antfu-skills"], ["worker"])
        coordinator_caps = {
            item["capability"] for item in manifest["roles"]["coordinator"]
        }
        worker_caps = {item["capability"] for item in manifest["roles"]["worker"]}
        self.assertIn("definition", coordinator_caps)
        self.assertIn("implementation", worker_caps)

    def test_create_team_builds_roster_and_persists_refs(self):
        agents = _AgentAPI()
        client = SimpleNamespace(beta=SimpleNamespace(agents=agents))
        refs = {
            "mattpocock-skills": [{"type": "custom", "skill_id": "skill_matt", "version": "1"}],
            "antfu-skills": [{"type": "custom", "skill_id": "skill_antfu", "version": "2"}],
            "octowiz-native": [{"type": "custom", "skill_id": "skill_octowiz", "version": "3"}],
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "team.json"
            config = create_team(
                client,
                environment_id="env_1",
                coordinator_model="coordinator-model",
                worker_model="worker-model",
                skill_refs=refs,
                config_path=path,
            )
            self.assertEqual(config["workerAgentId"], "agent_1")
            self.assertEqual(config["coordinatorAgentId"], "agent_2")
            self.assertEqual(
                agents.calls[1]["multiagent"]["agents"],
                [{"type": "agent", "id": "agent_1"}],
            )
            worker_ids = {item["skill_id"] for item in agents.calls[0]["skills"]}
            coordinator_ids = {item["skill_id"] for item in agents.calls[1]["skills"]}
            self.assertEqual(worker_ids, {"skill_matt", "skill_antfu", "skill_octowiz"})
            self.assertEqual(coordinator_ids, {"skill_matt", "skill_octowiz"})
            self.assertEqual(load_team_config(path)["environmentId"], "env_1")
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)


class TestManagedAgentsRuntime(unittest.TestCase):
    def test_session_stream_collects_threads_output_and_usage(self):
        events = [
            {"type": "thread_created", "id": "e1", "thread_id": "worker-1"},
            {
                "type": "span.model_request_end",
                "thread_id": "worker-1",
                "model_usage": {"input_tokens": 20, "output_tokens": 5},
            },
            {
                "type": "agent.message",
                "content": [{"type": "text", "text": "final synthesis"}],
                "usage": {"input_tokens": 10, "output_tokens": 4},
            },
            {"type": "session.status_idle"},
        ]
        sessions = _SessionAPI(events)
        client = SimpleNamespace(beta=SimpleNamespace(sessions=sessions))
        result = ManagedAgentsOrchestrator(client).run(
            task="audit packages",
            execution={
                "coordinatorAgentId": "agent_2",
                "coordinatorAgentVersion": 2,
                "environmentId": "env_1",
                "maxAgents": 4,
                "scope": "one worker per package",
                "verification": "cross-check results",
                "writes": False,
                "isolation": "none",
            },
            capability={
                "name": "architecture-review",
                "provider": "mattpocock-skills",
                "command": "improve-codebase-architecture",
                "role": "worker",
            },
        )
        self.assertEqual(result.session_id, "sesn_1")
        self.assertEqual(result.output, "final synthesis")
        self.assertEqual(result.usage["input_tokens"], 30)
        self.assertEqual(result.usage_by_thread["worker-1"]["output_tokens"], 5)
        self.assertIn("Use at most 4 workers", sessions.send_calls[0]["events"][0]["content"][0]["text"])

    def test_dispatch_uses_managed_path_without_claude_provider(self):
        result = SimpleNamespace(
            session_id="sesn_1",
            output="done",
            thread_events=[],
            usage={"input_tokens": 4},
            usage_by_thread={"coordinator": {"input_tokens": 4}},
        )
        event = {
            "task": "inspect code",
            "cwd": "/repo",
            "execution": {
                "pattern": "managed-agents",
                "partitionable": True,
                "scope": "one worker per package",
                "verification": "cross-check results",
                "maxAgents": 4,
                "coordinatorAgentId": "agent_2",
                "environmentId": "env_1",
                "writes": False,
                "isolation": "none",
            },
        }
        with patch("capabilities.dispatch.validate_cwd", return_value="/repo"):
            with patch("capabilities.dispatch._run_managed_agents", return_value=result) as run:
                artifact = __import__("asyncio").run(handle_dispatch(event))
        self.assertEqual(artifact["status"], "completed")
        self.assertEqual(artifact["session_id"], "sesn_1")
        run.assert_called_once()

    def test_dispatch_loads_persisted_profile_references(self):
        result = SimpleNamespace(
            session_id="sesn_2",
            output="done",
            thread_events=[],
            usage={},
            usage_by_thread={},
        )
        event = {
            "task": "inspect code",
            "cwd": "/repo",
            "execution": {
                "pattern": "managed-agents",
                "managedAgentsProfile": "default",
                "partitionable": True,
                "scope": "one worker per package",
                "verification": "cross-check results",
                "maxAgents": 4,
                "writes": False,
                "isolation": "none",
            },
        }
        team = {
            "coordinatorAgentId": "agent_persisted",
            "coordinatorAgentVersion": 9,
            "environmentId": "env_persisted",
            "workerAgentId": "agent_worker",
        }
        with patch("capabilities.dispatch.validate_cwd", return_value="/repo"):
            with patch("managed_agents_config.load_team_config", return_value=team):
                with patch("capabilities.dispatch._run_managed_agents", return_value=result) as run:
                    artifact = __import__("asyncio").run(handle_dispatch(event))
        execution = run.call_args.args[1]
        self.assertEqual(artifact["session_id"], "sesn_2")
        self.assertEqual(execution["coordinatorAgentId"], "agent_persisted")
        self.assertEqual(execution["coordinatorAgentVersion"], 9)
        self.assertEqual(execution["environmentId"], "env_persisted")
