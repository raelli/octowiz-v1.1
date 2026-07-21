"""Tests for the detached updater (apply.main) — event ordering, change detection,
state-file privacy — against a fake driver/render (no hidapi/Pillow needed)."""
import json
import os
import sys
import tempfile
import types
import unittest
import unittest.mock
from pathlib import Path

# repo root on path so `import packages.keyboard_hud` resolves under --import-mode=importlib
sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from packages.keyboard_hud import apply as apply_mod


class _FakeKB:
    def __init__(self, log):
        self._log = log

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def signal(self, state):
        self._log.append(("signal", state))

    def lcd_show_image(self, img):
        self._log.append(("lcd", img))


class TestApply(unittest.TestCase):
    def setUp(self):
        self.log = []
        self.orig_lock, self.orig_state = apply_mod._LOCK, apply_mod._STATE
        tmp = tempfile.mkdtemp()
        self._patches = [
            unittest.mock.patch.object(apply_mod, "_LOCK", os.path.join(tmp, "kbd.lock")),
            unittest.mock.patch.object(apply_mod, "_STATE", os.path.join(tmp, "kbd.state.json")),
            unittest.mock.patch.dict(sys.modules, self._fakes()),
        ]
        for p in self._patches:
            p.start()
            self.addCleanup(p.stop)

    def _fakes(self):
        drv = types.ModuleType("packages.keyboard_hud.driver")
        drv.available = lambda: True
        drv.AulaS75 = lambda open_lcd=False, verbose=False: _FakeKB(self.log)
        rnd = types.ModuleType("packages.keyboard_hud.render")
        rnd.render_hud = lambda state, title, stats=None, footer=None: (state, title, stats, footer)
        return {"packages.keyboard_hud.driver": drv, "packages.keyboard_hud.render": rnd}

    def _run(self, **directive):
        self.assertEqual(apply_mod.main(["apply", json.dumps(directive)]), 0)

    def _saved(self):
        with open(apply_mod._STATE, encoding="utf-8") as f:
            return json.load(f)

    def test_screen_render_and_state_saved(self):
        self._run(state="working", title="t", screen=True, stats={}, footer="f", _seq=10)
        self.assertIn(("signal", "working"), self.log)
        self.assertEqual([e for e in self.log if e[0] == "lcd"],
                         [("lcd", ("working", "t", {}, "f"))])
        self.assertEqual(self._saved()["screen"]["title"], "t")

    def test_stale_directive_dropped_entirely(self):
        # Stop (newer seq) lands first; the older Notification must not apply at all.
        self._run(state="idle", title="Your turn", screen=True, _seq=200)
        self.log.clear()
        self._run(state="attention", title="needs you", screen=True, _seq=100)
        self.assertEqual(self.log, [])                       # no lights, no screen
        self.assertEqual(self._saved()["screen"]["state"], "idle")
        self.assertEqual(self._saved()["seq"], 200)

    def test_lights_only_does_not_mask_screen_record(self):
        self._run(state="working", title="prompt A", screen=True, _seq=1)
        self._run(state="working", title="login.py", screen=False, _seq=2)  # lights-only
        self.assertEqual(self._saved()["screen"]["title"], "prompt A")
        self.log.clear()
        # a later screen event for the same visible content skips the upload...
        self._run(state="working", title="prompt A", screen=True, _seq=3)
        self.assertEqual([e for e in self.log if e[0] == "lcd"], [])
        # ...but "login.py" on screen would render, since the record says "prompt A"
        self.log.clear()
        self._run(state="working", title="login.py", screen=True, _seq=4)
        self.assertEqual(len([e for e in self.log if e[0] == "lcd"]), 1)

    def test_stats_or_footer_change_triggers_rerender(self):
        self._run(state="idle", title="Your turn", screen=True,
                  stats={"Tokens": "5k"}, footer="repoA · 09:00", _seq=1)
        self.log.clear()
        # same state+title, different footer/stats (two repos stopping) -> must re-render
        self._run(state="idle", title="Your turn", screen=True,
                  stats={"Tokens": "9k"}, footer="repoB · 09:05", _seq=2)
        self.assertEqual(len([e for e in self.log if e[0] == "lcd"]), 1)

    def test_metrics_merged_before_change_detection(self):
        fixture = str(Path(__file__).parent / "fixtures" / "transcript.jsonl")
        self._run(state="working", title="t", screen=True, _transcript=fixture, _seq=1)
        lcd = [e for e in self.log if e[0] == "lcd"][0]
        self.assertEqual(lcd[1][2]["Tokens"], "5.5k")
        self.assertEqual(self._saved()["screen"]["stats"]["Tokens"], "5.5k")

    def test_default_paths_are_per_user(self):
        tag = apply_mod._user_tag()
        self.assertTrue(tag)
        self.assertIn(tag, os.path.basename(self.orig_lock))
        self.assertIn(tag, os.path.basename(self.orig_state))

    @unittest.skipUnless(hasattr(os, "getuid"), "file modes are POSIX-only")
    def test_state_file_created_mode_0600(self):
        self._run(state="idle", title="prompt text is sensitive", screen=True, _seq=1)
        self.assertEqual(os.stat(apply_mod._STATE).st_mode & 0o777, 0o600)


if __name__ == "__main__":
    unittest.main()
