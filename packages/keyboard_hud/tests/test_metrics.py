"""Tests for apply.metrics — live token/elapsed parsing from a Claude Code transcript JSONL."""
import datetime
import sys
import unittest
from pathlib import Path

# repo root on path so `import packages.keyboard_hud` resolves under --import-mode=importlib
sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from packages.keyboard_hud.apply import metrics, _fmt_tokens, _fmt_elapsed

FIXTURE = str(Path(__file__).parent / "fixtures" / "transcript.jsonl")
UTC = datetime.timezone.utc


class TestMetricsFixture(unittest.TestCase):
    # fixture: 1000+500+2000 + 1200+800 = 5500 tokens, earliest ts 09:00:00Z
    def test_tokens_summed_incl_cache(self):
        self.assertEqual(metrics(FIXTURE)["Tokens"], "5.5k")

    def test_elapsed_from_earliest_timestamp(self):
        now = datetime.datetime(2026, 7, 21, 9, 9, 41, tzinfo=UTC)
        self.assertEqual(metrics(FIXTURE, now=now)["Elapsed"], "9:41")

    def test_elapsed_rolls_to_hours(self):
        now = datetime.datetime(2026, 7, 21, 10, 2, 5, tzinfo=UTC)
        self.assertEqual(metrics(FIXTURE, now=now)["Elapsed"], "1:02:05")


class TestMetricsDegradesGracefully(unittest.TestCase):
    def _write(self, lines):
        import tempfile, os
        fd, path = tempfile.mkstemp(suffix=".jsonl")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write("\n".join(lines))
        self.addCleanup(os.unlink, path)
        return path

    def test_missing_file_returns_empty(self):
        self.assertEqual(metrics("/nowhere/does-not-exist.jsonl"), {})

    def test_empty_transcript_returns_empty(self):
        self.assertEqual(metrics(self._write([])), {})

    def test_malformed_lines_skipped(self):
        path = self._write([
            "not json at all {{{",
            '"a bare string"',
            '{"type":"assistant","timestamp":"2026-07-21T09:00:00Z","message":{"usage":{"output_tokens":100}}}',
        ])
        m = metrics(path, now=datetime.datetime(2026, 7, 21, 9, 0, 30, tzinfo=UTC))
        self.assertEqual(m, {"Tokens": "100", "Elapsed": "0:30"})

    def test_no_usage_omits_tokens_row(self):
        path = self._write(['{"type":"user","timestamp":"2026-07-21T09:00:00Z"}'])
        m = metrics(path, now=datetime.datetime(2026, 7, 21, 9, 1, 0, tzinfo=UTC))
        self.assertNotIn("Tokens", m)
        self.assertEqual(m["Elapsed"], "1:00")

    def test_no_timestamps_omits_elapsed_row(self):
        path = self._write(['{"type":"assistant","message":{"usage":{"input_tokens":42}}}'])
        m = metrics(path)
        self.assertEqual(m["Tokens"], "42")
        self.assertNotIn("Elapsed", m)

    def test_bad_timestamp_and_non_dict_usage_ignored(self):
        path = self._write([
            '{"type":"assistant","timestamp":"yesterday-ish","message":{"usage":"lots"}}',
            '{"type":"assistant","timestamp":"2026-07-21T09:00:00+00:00","message":{"usage":{"input_tokens":7}}}',
        ])
        m = metrics(path, now=datetime.datetime(2026, 7, 21, 9, 0, 7, tzinfo=UTC))
        self.assertEqual(m, {"Tokens": "7", "Elapsed": "0:07"})

    def test_never_raises_on_directory_path(self):
        self.assertEqual(metrics(str(Path(__file__).parent)), {})


class TestFormatters(unittest.TestCase):
    def test_fmt_tokens(self):
        self.assertEqual(_fmt_tokens(0), "0")
        self.assertEqual(_fmt_tokens(950), "950")
        self.assertEqual(_fmt_tokens(5500), "5.5k")
        self.assertEqual(_fmt_tokens(112000), "112k")
        self.assertEqual(_fmt_tokens(2_400_000), "2.4M")

    def test_fmt_elapsed(self):
        self.assertEqual(_fmt_elapsed(0), "0:00")
        self.assertEqual(_fmt_elapsed(581), "9:41")
        self.assertEqual(_fmt_elapsed(3725), "1:02:05")
        self.assertEqual(_fmt_elapsed(-5), "0:00")  # clock skew never crashes


if __name__ == "__main__":
    unittest.main()
