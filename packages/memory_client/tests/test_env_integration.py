"""Integration tests for the Octowiz v1.1 first-run contract."""

import os
import shutil
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

from packages.memory_client.env import (
    MachineState,
    REQUIRED_PLUGINS,
    _now_iso,
    dismiss_check,
    init_machine_state,
    run_live_check,
    save_machine_state,
)


def _git_mock(repo_root: str):
    result = MagicMock()
    result.returncode = 0
    result.stdout = repo_root + "\n"
    return result


class TestFirstRunIntegration(unittest.TestCase):
    def setUp(self):
        self.repo_tmp = tempfile.TemporaryDirectory()
        self.state_tmp = tempfile.TemporaryDirectory()
        self.cwd = Path(self.repo_tmp.name)
        self.machine_state_path = Path(self.state_tmp.name) / "machine-state.json"
        self.plugins_base = Path(self.state_tmp.name) / "plugins"

    def tearDown(self):
        self.repo_tmp.cleanup()
        self.state_tmp.cleanup()

    def check(self, env=None):
        with patch("subprocess.run", return_value=_git_mock(str(self.cwd))):
            with patch.dict(os.environ, env or {}, clear=True):
                return run_live_check(self.cwd, self.machine_state_path, self.plugins_base)

    def install_required_plugins(self):
        for plugin_id in REQUIRED_PLUGINS:
            (self.plugins_base / "official" / plugin_id).mkdir(parents=True)

    def configure_clean_machine(self):
        machine = init_machine_state(self.machine_state_path)
        machine.litellm["routing_verified_at"] = _now_iso()
        save_machine_state(machine, self.machine_state_path)

    def create_mattpocock_setup_files(self):
        agents_dir = self.cwd / "docs" / "agents"
        agents_dir.mkdir(parents=True)
        (agents_dir / "issue-tracker.md").write_text("# Issue tracker\n")
        (agents_dir / "domain.md").write_text("# Domain\n")

    def test_fresh_environment_requires_only_matt_pocock(self):
        (self.cwd / "pyproject.toml").write_text("[project]\nname='myapp'")
        result = self.check()

        self.assertIn("plugin_mattpocock-skills", result.hard_gaps)
        self.assertNotIn("plugin_superpowers", result.hard_gaps)
        self.assertNotIn("plugin_antfu-skills", result.hard_gaps)
        self.assertIn("litellm_env", result.hard_gaps)
        self.assertIn("litellm_cache", result.hard_gaps)
        self.assertIn("agent_file", result.advisory_gaps)

    def test_complete_python_setup_is_clean(self):
        self.install_required_plugins()
        self.configure_clean_machine()
        (self.cwd / "AGENTS.md").write_text("## Agent skills\n- mattpocock\n")
        self.create_mattpocock_setup_files()
        (self.cwd / "pyproject.toml").write_text("[project]\nname='myapp'")

        result = self.check({
            "LITELLM_BASE_URL": "http://localhost:4000",
            "LITELLM_ADMIN_API_KEY": "test",
        })

        self.assertEqual(result.hard_gaps, [])
        self.assertEqual(result.advisory_gaps, [])

    def test_required_plugin_removal_is_detected(self):
        self.install_required_plugins()
        self.configure_clean_machine()
        (self.cwd / "AGENTS.md").write_text("## Agent skills\n- mattpocock\n")
        (self.cwd / "pyproject.toml").write_text("[project]\nname='myapp'")
        env = {"LITELLM_BASE_URL": "http://localhost:4000", "LITELLM_ADMIN_API_KEY": "test"}

        self.assertEqual(self.check(env).hard_gaps, [])
        shutil.rmtree(self.plugins_base / "official" / "mattpocock-skills")
        self.assertIn("plugin_mattpocock-skills", self.check(env).hard_gaps)

    def test_vue_repo_reports_antfu_as_advisory_only(self):
        (self.cwd / "package.json").write_text('{"dependencies":{"vue":"^3"}}')
        result = self.check()

        self.assertIn("antfu_optional", result.advisory_gaps)
        self.assertNotIn("antfu", result.hard_gaps)
        self.assertNotIn("plugin_antfu-skills", result.hard_gaps)

    def test_dismissed_deployment_check_survives(self):
        with patch("subprocess.run", return_value=_git_mock(str(self.cwd))):
            dismiss_check("litellm_env", self.cwd, self.machine_state_path)
        result = self.check()
        self.assertNotIn("litellm_env", result.hard_gaps)
        self.assertIn("litellm_cache", result.hard_gaps)

    def test_stale_memory_cache_is_detected(self):
        self.install_required_plugins()
        machine = MachineState(first_seen=_now_iso())
        stale = datetime.now(timezone.utc) - timedelta(hours=25)
        machine.litellm["routing_verified_at"] = stale.strftime("%Y-%m-%dT%H:%M:%SZ")
        save_machine_state(machine, self.machine_state_path)
        (self.cwd / "AGENTS.md").write_text("## Agent skills\n- mattpocock\n")
        self.create_mattpocock_setup_files()
        (self.cwd / "pyproject.toml").write_text("[project]\nname='myapp'")

        result = self.check({
            "LITELLM_BASE_URL": "http://localhost:4000",
            "LITELLM_ADMIN_API_KEY": "test",
        })
        self.assertIn("litellm_cache", result.hard_gaps)


if __name__ == "__main__":
    unittest.main()
