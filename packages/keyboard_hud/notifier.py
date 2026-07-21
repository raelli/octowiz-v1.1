"""
Map normalised Claude Code hook events to AULA S75 keyboard states, and dispatch the
keyboard update out-of-band so the hook never blocks.

Contract (mirrors apps/claude_code_bridge/bridge.py):
  * Opt-in only: does nothing unless OCTOWIZ_KEYBOARD is truthy.
  * Never raises, never writes to stdout (stdout is the hook's JSON channel).
  * Diagnostics go to stderr, gated by OCTOWIZ_VERBOSE.
  * The actual keyboard I/O (a ~0.7s screen upload) runs in a DETACHED process, so this
    returns immediately and adds no latency to the developer's prompt/tool events.

This module is stdlib-only at import time; the hidapi/Pillow-backed driver and renderer are
imported only inside the detached apply.py process.
"""
import datetime
import json
import os
import subprocess
import sys
import time
from pathlib import Path

_PURPLE = "\033[38;5;135m"
_BOLD = "\033[1m"
_DIM = "\033[2m"
_RESET = "\033[0m"


def _truthy(v):
    return str(v).lower() in ("1", "true", "yes", "on")


def _log(msg):
    if _truthy(os.environ.get("OCTOWIZ_VERBOSE", "")):
        ts = datetime.datetime.now().strftime("%H:%M:%S")
        print("%s%s[--*]%s %s%s%s %s" % (_BOLD, _PURPLE, _RESET, _DIM, ts, _RESET, msg), file=sys.stderr)


def _short(s, n=60):
    s = " ".join((s or "").split())
    return s if len(s) <= n else s[: n - 1] + "…"


def map_event(data):
    """Pure mapping: raw Claude Code hook `data` dict -> keyboard directive dict, or None to skip.

    Directive: {state, title, stats, footer, screen}
      state  : one of working|attention|idle|done|error (drives both lights and the card)
      screen : whether to (re-)render the 135x240 card; False = lights-only (cheap, for
               high-frequency events like every file edit)
    """
    hook = data.get("hook_event_name", "")
    repo = ""
    cwd = data.get("cwd", "")
    if cwd:
        repo = os.path.basename(cwd.rstrip("/\\"))
    now = datetime.datetime.now().strftime("%H:%M")
    foot = ("%s · %s" % (repo, now)) if repo else now

    directive = None
    if hook == "Notification":
        msg = data.get("message") or "Needs your input"
        directive = {"state": "attention", "title": _short(msg), "stats": {}, "footer": foot, "screen": True}

    elif hook == "UserPromptSubmit":
        directive = {"state": "working", "title": _short(data.get("prompt", "") or "Working…"),
                     "stats": {}, "footer": foot, "screen": True}

    elif hook == "PostToolUse":
        ti = data.get("tool_input", {}) or {}
        path = ti.get("file_path") or ti.get("notebook_path") or ""
        title = os.path.basename(path) if path else (data.get("tool_name", "") or "Working…")
        # High-frequency event: update lights only, skip the screen upload.
        directive = {"state": "working", "title": _short(title), "stats": {}, "footer": foot, "screen": False}

    elif hook == "SessionStart":
        directive = {"state": "idle", "title": repo or "Session started", "stats": {}, "footer": foot, "screen": True}

    elif hook in ("Stop", "SessionEnd"):
        directive = {"state": "idle", "title": "Your turn", "stats": {}, "footer": foot, "screen": True}

    if directive is None:
        return None
    if directive["screen"]:
        # Private key (not a display field): lets the detached updater derive live session
        # metrics from the transcript without any file IO on this hot path.
        directive["_transcript"] = data.get("transcript_path", "")
    return directive


def _spawn(directive):
    """Launch the detached updater and return immediately. Isolated for testing."""
    interp = os.environ.get("OCTOWIZ_KEYBOARD_PYTHON") or sys.executable
    if not interp:
        _log("kb: skip (no interpreter)")
        return
    root = str(Path(__file__).resolve().parents[2])  # repo root (packages/keyboard_hud/..)
    kwargs = dict(cwd=root, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                  stderr=subprocess.DEVNULL, close_fds=True)
    if os.name == "nt":
        kwargs["creationflags"] = 0x00000008 | 0x00000200  # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
    else:
        kwargs["start_new_session"] = True
    subprocess.Popen([interp, "-m", "packages.keyboard_hud.apply", json.dumps(directive)], **kwargs)


def notify(data):
    """Entry point called by the bridge. Opt-in, non-blocking, never raises."""
    try:
        if not _truthy(os.environ.get("OCTOWIZ_KEYBOARD", "")):
            _log("kb: skip (OCTOWIZ_KEYBOARD not set)")
            return
        directive = map_event(data)
        if directive is None:
            _log("kb: skip (no mapping for %s)" % data.get("hook_event_name", "?"))
            return
        # Dispatch-order sequence: detached updaters may acquire the keyboard lock out of
        # startup order; apply.py uses this to drop directives older than the last applied.
        directive["_seq"] = time.time_ns()
        _spawn(directive)
        _log("kb: dispatched state=%s screen=%s" % (directive["state"], directive["screen"]))
    except Exception as exc:  # never break the developer's session
        _log("kb: error %s" % exc)
