"""
Detached updater: apply one keyboard directive to the AULA S75.

Run as:  python -m packages.keyboard_hud.apply '<directive-json>'

Spawned by notifier._spawn in its own process so the ~0.7s screen upload never blocks the
Claude Code hook. Best-effort cross-process lock serialises access to the single keyboard;
change-detection avoids re-uploading an unchanged screen. Always exits 0.
"""
import datetime
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


def _fmt_tokens(n):
    """5500 -> '5.5k', 112000 -> '112k', 2_400_000 -> '2.4M', 950 -> '950'."""
    if n >= 1_000_000:
        return ("%.1fM" % (n / 1_000_000)).replace(".0M", "M")
    if n >= 1000:
        return ("%.1fk" % (n / 1000)).replace(".0k", "k")
    return str(n)


def _fmt_elapsed(seconds):
    """581 -> '9:41', 3725 -> '1:02:05'."""
    s = max(0, int(seconds))
    h, rem = divmod(s, 3600)
    m, sec = divmod(rem, 60)
    return ("%d:%02d:%02d" % (h, m, sec)) if h else ("%d:%02d" % (m, sec))


def metrics(transcript_path, now=None):
    """Sum live session metrics from a Claude Code transcript JSONL.

    Returns up to {"Tokens": "112k", "Elapsed": "9:41"} — best-effort: a missing file,
    malformed lines, or absent usage/timestamp fields just omit the affected row.
    Never raises.
    """
    out = {}
    try:
        with open(transcript_path, "r", encoding="utf-8", errors="replace") as f:
            lines = f.read().splitlines()
    except OSError:
        return out

    total, saw_usage, earliest = 0, False, None
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            entry = json.loads(line)
        except ValueError:
            continue
        if not isinstance(entry, dict):
            continue

        ts = entry.get("timestamp")
        if isinstance(ts, str) and ts:
            try:
                dt = datetime.datetime.fromisoformat(ts.replace("Z", "+00:00"))
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=datetime.timezone.utc)
                if earliest is None or dt < earliest:
                    earliest = dt
            except ValueError:
                pass

        if entry.get("type") != "assistant":
            continue
        msg = entry.get("message")
        usage = msg.get("usage") if isinstance(msg, dict) else None
        if not isinstance(usage, dict):
            continue
        for key in ("input_tokens", "output_tokens",
                    "cache_creation_input_tokens", "cache_read_input_tokens"):
            v = usage.get(key, 0)
            if isinstance(v, (int, float)):
                total += int(v)
        saw_usage = True

    if saw_usage:
        out["Tokens"] = _fmt_tokens(total)
    if earliest is not None:
        now = now or datetime.datetime.now(datetime.timezone.utc)
        out["Elapsed"] = _fmt_elapsed((now - earliest).total_seconds())
    return out


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
                stats = d.get("stats") or {}
                transcript = d.get("_transcript", "")
                if transcript:
                    try:
                        stats = {**metrics(transcript), **stats}  # explicit stats win
                    except Exception:
                        pass  # card just shows fewer rows
                img = render_hud(state, title, stats=stats, footer=d.get("footer"))
                kb.lcd_show_image(img)
        _save_state({"state": state, "title": title})
    except Exception:
        pass  # never crash a detached updater
    finally:
        _release(fd)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
