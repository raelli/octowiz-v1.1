import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from packages.memory_client.env import (
    MachineState,
    RepoState,
    REQUIRED_PLUGINS,
    OPTIONAL_PLUGINS,
    _antfu_gap,
    _now_iso,
    detect_all_plugins,
    detect_plugin,
    init_machine_state,
    init_repo_state,
    load_machine_state,
    load_repo_state,
    run_live_check,
    save_machine_state,
    save_repo_state,
    scan_repo,
)


class TempCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.cwd = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()


class TestState(TempCase):
    def test_machine_state_roundtrip(self):
        path = self.cwd / "machine.json"
        state = init_machine_state(path)
        state.plugins["mattpocock-skills"] = "verified"
        save_machine_state(state, path)
        self.assertEqual(load_machine_state(path).plugins["mattpocock-skills"], "verified")

    def test_repo_state_roundtrip(self):
        state = init_repo_state(self.cwd)
        state.antfu_relevant = True
        save_repo_state(state, self.cwd)
        self.assertTrue(load_repo_state(self.cwd).antfu_relevant)

    def test_corrupt_state_is_treated_as_absent(self):
        path = self.cwd / "machine.json"
        path.write_text("{broken")
        self.assertIsNone(load_machine_state(path))


class TestPluginContract(TempCase):
    def test_only_matt_pocock_is_required(self):
        self.assertEqual(REQUIRED_PLUGINS, ["mattpocock-skills"])
        self.assertEqual(OPTIONAL_PLUGINS, ["antfu-skills"])

    def test_plugin_detection(self):
        base = self.cwd / "plugins"
        (base / "marketplace" / "mattpocock-skills").mkdir(parents=True)
        self.assertTrue(detect_plugin("mattpocock-skills", base))
        self.assertFalse(detect_plugin("antfu-skills", base))
        self.assertEqual(detect_all_plugins(REQUIRED_PLUGINS, base), {"mattpocock-skills": True})


class TestRepoScan(TempCase):
    def test_vue_nuxt_stack_makes_antfu_relevant(self):
        (self.cwd / "package.json").write_text(json.dumps({"dependencies": {"nuxt": "^4"}}))
        scan = scan_repo(self.cwd)
        self.assertEqual(scan.stack, "ts_vue")
        self.assertTrue(_antfu_gap(scan, None))

    def test_python_stack_does_not_make_antfu_relevant(self):
        (self.cwd / "pyproject.toml").write_text("[project]\nname='example'")
        scan = scan_repo(self.cwd)
        self.assertEqual(scan.stack, "python")
        self.assertFalse(_antfu_gap(scan, None))

    def test_agent_file_priority_and_skills_section(self):
        (self.cwd / "CLAUDE.md").write_text("# Claude")
        (self.cwd / "AGENTS.md").write_text("## Agent skills\n- mattpocock")
        scan = scan_repo(self.cwd)
        self.assertEqual(scan.agent_file, "AGENTS.md")
        self.assertTrue(scan.agent_has_skills_section)


class TestLiveCheck(TempCase):
    def setUp(self):
        super().setUp()
        self.machine_state_path = self.cwd / "machine.json"
        self.plugins_base = self.cwd / "plugins"

    def test_fresh_environment_never_requires_superpowers_or_antfu(self):
        (self.cwd / "package.json").write_text('{"dependencies":{"vue":"^3"}}')
        with patch.dict(os.environ, {}, clear=True):
            result = run_live_check(self.cwd, self.machine_state_path, self.plugins_base)

        self.assertIn("plugin_mattpocock-skills", result.hard_gaps)
        self.assertNotIn("plugin_superpowers", result.hard_gaps)
        self.assertNotIn("plugin_antfu-skills", result.hard_gaps)
        self.assertNotIn("antfu", result.hard_gaps)
        self.assertIn("antfu_optional", result.advisory_gaps)

    def test_clean_environment(self):
        (self.plugins_base / "marketplace" / "mattpocock-skills").mkdir(parents=True)
        machine = MachineState(first_seen=_now_iso())
        machine.litellm["routing_verified_at"] = _now_iso()
        save_machine_state(machine, self.machine_state_path)
        save_repo_state(RepoState(antfu_setup=False), self.cwd)
        (self.cwd / "AGENTS.md").write_text("## Agent skills\n- mattpocock")
        (self.cwd / "pyproject.toml").write_text("[project]\nname='test'")

        with patch.dict(os.environ, {
            "LITELLM_BASE_URL": "http://localhost:4000",
            "LITELLM_ADMIN_API_KEY": "test",
        }, clear=True):
            result = run_live_check(self.cwd, self.machine_state_path, self.plugins_base)

        self.assertEqual(result.hard_gaps, [])
        self.assertEqual(result.advisory_gaps, [])


if __name__ == "__main__":
    unittest.main()
