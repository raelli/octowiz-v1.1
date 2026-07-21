# keyboard_hud — AULA S75 Pro agent HUD

Drives an **AULA S75 Pro** keyboard's 135×240 screen and RGB lighting from Claude Code / Octowiz
hook events, so you get ambient session status without alt-tabbing.

| Event | Screen | Lights |
|-------|--------|--------|
| `UserPromptSubmit` | **WORKING** + prompt | breathing white |
| `PostToolUse` | (lights only) | breathing white |
| `Notification` (permission / HITL) | **NEEDS YOU** + message | fast-breathing red |
| `Stop` | **READY** – your turn | dim blue |
| `SessionStart` | repo name | dim blue |

Header uses Octowiz purple (`#8B5CF6`).

## Enable

```bash
pip install -e ".[keyboard]"          # installs hidapi + Pillow
export OCTOWIZ_KEYBOARD=1              # opt in (off by default)
# Windows: python3 doesn't resolve — pin the interpreter that has the extra:
export OCTOWIZ_KEYBOARD_PYTHON="C:\\path\\to\\python.exe"
```

The `Notification` and `Stop` hooks in `hooks/hooks.json` route to the bridge, which dispatches a
**detached** updater — the ~0.7s screen upload never blocks your prompts. Set `OCTOWIZ_VERBOSE=1`
to see `[--*] kb: …` dispatch/skip lines on stderr.

## Design & safety

See [ADR 0002](../../docs/adr/0002-keyboard-hud-notifier.md). Two firmware-bricking hazards are
guarded in `driver.py`: pixel pages are only sent as **output reports** (never feature reports),
and the frame count is hard-capped at **141**. `hidapi`/`Pillow` are optional and load only in
the detached process, so the package is import-safe on CI without them.

## Standalone use

```python
from packages.keyboard_hud.driver import AulaS75
with AulaS75(open_lcd=True) as kb:
    kb.signal("attention")            # working|done|attention|error|idle
    from packages.keyboard_hud.render import render_hud
    kb.lcd_show_image(render_hud("working", "Refactor auth", {"Tokens": "48k"}))
```
