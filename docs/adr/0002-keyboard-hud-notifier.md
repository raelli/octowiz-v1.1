# 2. AULA S75 Pro keyboard HUD notifier

Date: 2026-07-21

## Status

Accepted

## Context

Developers running Octowiz want ambient, at-a-glance session feedback on the AULA S75 Pro
keyboard's 135×240 screen and RGB, without alt-tabbing: purple **WORKING** while active, a red
**NEEDS YOU** when Claude Code raises a permission/HITL notification, and a soft **READY** when
control returns to the human. The keyboard speaks a Sonix/AULA vendor HID protocol (verified on
the near-identical F108 Pro) — lighting over a 64-byte feature-report channel (usage page
0xFF13) and screen images over a 4096-byte output-report channel (0xFF68).

Constraints:
- The hook path (`apps/claude_code_bridge/bridge.py`) must never block or crash the developer;
  its stdout is a structured `{"systemMessage": …}` channel consumed by Claude Code.
- A full screen upload is ~0.7s (16 pages × ~35ms). UserPromptSubmit fires on every prompt, so
  synchronous uploads would tax normal use.
- `hidapi`/`Pillow` must not become hard Octowiz dependencies; most users have no such keyboard.
- Two documented ways to brick the device: sending pixel pages as feature reports (firmware
  crash until power-cycle), and exceeding 141 frames (permanent SPI-flash overwrite).

## Decision

Add `packages/keyboard_hud/` with a driver (`driver.py`), a 135×240 renderer (`render.py`), and
a `notifier.py` exposing `notify(data)`. `bridge.py` calls it as an **opt-in** sink
(`OCTOWIZ_KEYBOARD=1`), right after parsing stdin and before the AELLI network calls, wrapped so
it never raises.

- **Driven by raw hook `data`, not `_build_event`.** The keyboard is a pure side-channel; it
  does not change what is forwarded to AELLI. `Notification` and `Stop` hooks are added to
  `hooks.json` and reach the bridge, but `_build_event` still returns `None` for them, so no new
  AELLI event types are emitted.
- **Detached updater.** `notify()` maps the event to a directive and spawns a detached
  `python -m packages.keyboard_hud.apply` process, returning immediately. The 0.7s upload never
  sits on the hook's critical path. A best-effort file lock serialises access to the single
  keyboard; a state file suppresses re-uploading an unchanged screen. High-frequency
  `PostToolUse` events update lights only (no screen).
- **Import-safe.** `hidapi`/`Pillow` are guarded imports and load only inside the detached
  process, so `pytest` collection (which imports `packages/*`) stays green on CI without them.
  They are declared as the optional `keyboard` extra.
- **Safety guards live in the driver:** pixel pages are only ever written as output reports, and
  frame count is hard-capped at 141.

## Consequences

- One physical keyboard, N concurrent Octowiz sessions ⇒ **last-writer-wins**; the screen shows
  the most recent session's state, not an aggregate. Accepted; revisit if multi-session
  aggregation is wanted.
- The interpreter Octowiz's hooks run must have the `keyboard` extra installed. The updater uses
  `OCTOWIZ_KEYBOARD_PYTHON` if set, else `sys.executable`. Note bare `python3` does not resolve
  on stock Windows — pin `OCTOWIZ_KEYBOARD_PYTHON` there.
- Feature is inert unless `OCTOWIZ_KEYBOARD` is set and a keyboard is present; every skip path is
  logged under `OCTOWIZ_VERBOSE`.
