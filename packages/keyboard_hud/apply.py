"""
Detached updater: apply one keyboard directive to the AULA S75.

Run as:  python -m packages.keyboard_hud.apply '<directive-json>'

Spawned by notifier._spawn in its own process so the ~0.7s screen upload never blocks the
Claude Code hook. Best-effort cross-process lock serialises access to the single keyboard;
change-detection avoids re-uploading an unchanged screen. Always exits 0.
"""
import json
import os
import sys
import tempfile
import time

_LOCK = os.path.join(tempfile.gettempdir(), "octowiz_kbd.lock")
_STATE = os.path.join(tempfile.gettempdir(), "octowiz_kbd.state.json")


def _acquire(timeout=3.0):
    """Best-effort exclusive lock via O_CREAT|O_EXCL. Returns fd or None."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            fd = os.open(_LOCK, os.O_CREAT | os.O_EXCL | os.O_RDWR)
            return fd
        except FileExistsError:
            # stale lock older than 15s -> reclaim
            try:
                if time.time() - os.path.getmtime(_LOCK) > 15:
                    os.unlink(_LOCK)
                    continue
            except OSError:
                pass
            time.sleep(0.1)
    return None


def _release(fd):
    try:
        os.close(fd)
    finally:
        try:
            os.unlink(_LOCK)
        except OSError:
            pass


def _last_state():
    try:
        with open(_STATE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _save_state(d):
    try:
        with open(_STATE, "w", encoding="utf-8") as f:
            json.dump(d, f)
    except Exception:
        pass


def main(argv):
    if len(argv) < 2:
        return 0
    try:
        d = json.loads(argv[1])
    except Exception:
        return 0

    state = d.get("state", "idle")
    title = d.get("title", "")
    want_screen = bool(d.get("screen"))

    fd = _acquire()
    if fd is None:
        return 0  # another update in flight; drop this one (fire-and-forget)
    try:
        from packages.keyboard_hud.driver import AulaS75, available
        if not available():
            return 0
        # only re-render the screen if it actually changed
        last = _last_state()
        screen_changed = want_screen and (last.get("state") != state or last.get("title") != title)

        with AulaS75(open_lcd=screen_changed, verbose=False) as kb:
            kb.signal(state)
            if screen_changed:
                from packages.keyboard_hud.render import render_hud
                img = render_hud(state, title, stats=d.get("stats"), footer=d.get("footer"))
                kb.lcd_show_image(img)
        _save_state({"state": state, "title": title})
    except Exception:
        pass  # never crash a detached updater
    finally:
        _release(fd)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
