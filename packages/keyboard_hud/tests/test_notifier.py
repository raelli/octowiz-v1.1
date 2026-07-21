"""Tests for packages/keyboard_hud — event mapping, opt-in gating, dispatch, import-safety."""
import os
import sys
import unittest
import unittest.mock
from pathlib import Path

# repo root on path so `import packages.keyboard_hud` resolves under --import-mode=importlib
sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from packages.keyboard_hud import map_event, notify
from packages.keyboard_hud import notifier


def _data(hook, **extra):
    d = {"hook_event_name": hook, "session_id": "s1", "cwd": "/home/u/myrepo"}
    d.update(extra)
    return d


class TestMapEvent(unittest.TestCase):
    def test_notification_is_attention_with_screen(self):
        d = map_event(_data("Notification", message="Claude needs your permission to run rm"))
        self.assertEqual(d["state"], "attention")
        self.assertTrue(d["screen"])
        self.assertIn("permission", d["title"])

    def test_prompt_is_working_with_screen(self):
        d = map_event(_data("UserPromptSubmit", prompt="Refactor the auth module please"))
        self.assertEqual(d["state"], "working")
        self.assertTrue(d["screen"])
        self.assertIn("Refactor", d["title"])

    def test_posttooluse_is_lights_only(self):
        d = map_event(_data("PostToolUse", tool_name="Edit", tool_input={"file_path": "src/auth/login.py"}))
        self.assertEqual(d["state"], "working")
        self.assertFalse(d["screen"])          # high-frequency -> lights only
        self.assertEqual(d["title"], "login.py")

    def test_session_start_is_idle(self):
        self.assertEqual(map_event(_data("SessionStart"))["state"], "idle")

    def test_stop_is_idle_screen(self):
        d = map_event(_data("Stop"))
        self.assertEqual(d["state"], "idle")
        self.assertTrue(d["screen"])

    def test_unknown_hook_returns_none(self):
        self.assertIsNone(map_event(_data("PreToolUse")))

    def test_footer_contains_repo_basename(self):
        self.assertIn("myrepo", map_event(_data("Stop"))["footer"])

    def test_screen_events_pass_transcript_through(self):
        for hook, extra in (("Notification", {"message": "hi"}),
                            ("UserPromptSubmit", {"prompt": "go"}),
                            ("SessionStart", {}),
                            ("Stop", {})):
            d = map_event(_data(hook, transcript_path="/tmp/t.jsonl", **extra))
            self.assertEqual(d["_transcript"], "/tmp/t.jsonl", hook)

    def test_screen_events_transcript_defaults_empty(self):
        self.assertEqual(map_event(_data("Stop"))["_transcript"], "")

    def test_posttooluse_has_no_transcript_key(self):
        d = map_event(_data("PostToolUse", tool_name="Edit",
                            tool_input={"file_path": "a.py"}, transcript_path="/tmp/t.jsonl"))
        self.assertNotIn("_transcript", d)  # lights-only: no metrics needed


class TestNotifyGating(unittest.TestCase):
    def test_skips_when_opt_out(self):
        with unittest.mock.patch.dict(os.environ, {"OCTOWIZ_KEYBOARD": ""}, clear=False), \
             unittest.mock.patch.object(notifier, "_spawn") as spawn:
            notify(_data("Notification", message="hi"))
            spawn.assert_not_called()

    def test_dispatches_when_opt_in(self):
        with unittest.mock.patch.dict(os.environ, {"OCTOWIZ_KEYBOARD": "1"}, clear=False), \
             unittest.mock.patch.object(notifier, "_spawn") as spawn:
            notify(_data("UserPromptSubmit", prompt="do a thing"))
            spawn.assert_called_once()
            directive = spawn.call_args[0][0]
            self.assertEqual(directive["state"], "working")

    def test_no_dispatch_for_unmapped_event(self):
        with unittest.mock.patch.dict(os.environ, {"OCTOWIZ_KEYBOARD": "1"}, clear=False), \
             unittest.mock.patch.object(notifier, "_spawn") as spawn:
            notify(_data("PreToolUse"))
            spawn.assert_not_called()

    def test_never_raises_when_spawn_explodes(self):
        with unittest.mock.patch.dict(os.environ, {"OCTOWIZ_KEYBOARD": "1"}, clear=False), \
             unittest.mock.patch.object(notifier, "_spawn", side_effect=RuntimeError("boom")):
            notify(_data("Stop"))  # must not raise


class TestImportSafety(unittest.TestCase):
    def test_package_imports_without_hid_or_pil(self):
        # driver/render must be import-safe even when hidapi/Pillow are absent.
        from packages.keyboard_hud import driver, render
        self.assertTrue(hasattr(driver, "AulaS75"))
        self.assertTrue(hasattr(render, "render_hud"))

    def test_available_false_without_hidapi(self):
        from packages.keyboard_hud import driver
        with unittest.mock.patch.object(driver, "_hid", None):
            self.assertFalse(driver.available())


if __name__ == "__main__":
    unittest.main()
