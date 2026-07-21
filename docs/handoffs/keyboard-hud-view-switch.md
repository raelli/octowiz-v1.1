# Handoff: programmatic screen view-switch (so the HUD can summon ELLI by itself)

**Status:** ready-for-human — **blocked on a one-time, user-granted admin elevation, an
elevated vendor app, and physical knob interaction (not an AFK-agent task; see
`docs/agents/triage-labels.md`). Flip to `ready-for-agent` only once the HID capture below
has been supplied.**
**Area:** `packages/keyboard_hud` (driver) + a throwaway sniffing harness (not committed)
**Depends on:** the merged keyboard HUD sink + card skin. Independent of any open PR.
**Est. size:** medium — the *investigation* is the work; the code change is small if a command exists.

## Goal

Today the AULA S75 Pro shows **one** of several on-device "views" — clock, battery,
and the uploaded image/GIF slots. Which view is displayed is chosen **physically**:
long-press **Fn + knob** to put the knob in screen-adjust mode, then **rotate** to cycle
views. There is no known way to change the displayed view from code.

We want a **programmatic view-switch**: a command the host can send so the HUD process
can flip the screen to a chosen slot on its own — e.g. show **ELLI** (slot 2) when a
session goes idle / ends, and flip back to the **status card** (slot 1) when work
resumes. That turns the two stored images into an actual software-driven screensaver
instead of two static pictures the user has to knob between.

## Why this is blocked (and why it needs elevation)

The view-select command, **if it exists**, is not in any protocol we have:

- Our driver (`packages/keyboard_hud/driver.py`) and the community research
  (parsiya/f108-pro, same driver/firmware family) document only **upload**
  (`04 18` begin → `04 72` image header w/ slot byte → 4096-byte pages on the
  `0xFF68` bulk channel → `04 02` apply), **clock sync** (`04 28`), and **lighting**.
  None of them switch which view is shown.
- Notably, parsiya's Ghidra notes say the uploader (`FUN_00422b50`, task type 16)
  **step 1 "gets the current LCD view selection"** — so the firmware *has* a
  "current view" concept that the app reads. Where the app **sets** it (if at all over
  HID, vs. knob-only) is the unknown to resolve.

To find it we must watch the vendor app's HID traffic while a view change happens in
its UI. That means hooking `HidD_SetFeature` / `HidD_GetFeature` / `WriteFile` (e.g.
with Frida) on **`DeviceDriver.exe`** (`C:\Program Files (x86)\S75Pro\`), which runs
**elevated at login** and holds a single-instance mutex. Attaching/spawning at matching
integrity requires a **one-time, user-approved UAC elevation** — self-elevation is
(correctly) refused by the environment, so this step waits for the user to explicitly
grant admin for the sniffing session. Everything here is the user's own hardware and
their own installed vendor app on their own machine.

## Approach

1. **Capture (needs admin).** With the S75 in **wired** mode and the keyboard idle,
   start the sniffer and hook the three HID entry points on `DeviceDriver.exe`. Log
   every feature/output report with report-id, opcode bytes, and the interface
   (`0xFF13` command vs. `0xFF68` bulk).
2. **Provoke the exact event.** In the vendor UI, switch the *displayed* view with no
   other change — e.g. select a different stored image / toggle to the clock and back.
   Do it several times, and also try switching **via the knob** while sniffing, to see
   whether the knob path emits the same HID command or is purely firmware-internal
   (if knob switching produces **no** host traffic, a host command may still exist on
   the app path — keep looking; if the app also produces none, the feature likely
   isn't exposed over HID at all → see fallback).
3. **Isolate the opcode.** Diff the logs across switches to find the report that
   changes only with the view index. Expect a short `04 xx` feature report on the
   `0xFF13` channel (the family's control channel), plausibly carrying a view/slot
   index byte and the usual `AA 55` / `55 AA` trailer. Derive the opcode from the capture
   diff — do **not** guess from our existing map. In particular **exclude the opcodes we
   already use**: `04 13` (light-init) and `04 F0` (finalize) are emitted by `set_mode()`
   in `driver.py`, `04 28` is clock, and `04 18`/`04 72`/`04 02` frame uploads — routine
   lighting/clock traffic in a capture will show these, and they are *not* the view-select
   command. Require a payload-level reason (a byte that tracks the view index) before
   trusting any candidate.
4. **Replay to confirm.** Reproduce the captured command through our own HID handle
   (`_feature(...)` on the command channel) and confirm the screen switches with the
   vendor app closed. Nail down the byte layout (view id, whether a begin/apply frames
   it like uploads do, any readback ACK).
5. **Ship it.** Add `set_view(view)` / `show_slot(n)` to `driver.py` (mirroring the
   existing `04 xx` command helpers, best-effort + fail-safe), then wire the HUD:
   `apply.py` flips to ELLI on `Stop`/`SessionEnd` and back to the card on the next
   screen event. Keep it inside the existing lock + change-detection so it doesn't fight
   concurrent updates.
   - **Prerequisite — session awareness does not exist yet.** For v1, treat *this*
     session's `Stop`/`SessionEnd` as "go to ELLI" (last-writer-wins, matching the sink's
     current behaviour) and accept that with N concurrent sessions the screen may show
     ELLI while another session is still working. Only gate on "no other live session"
     if you first add an active-session registry: `notifier.map_event()` currently
     **discards `session_id`**, and `apply.py` persists only the latest `seq` + screen
     description — there is no set of live sessions to consult. Scope that registry in
     explicitly (session-id passthrough + a small liveness file keyed by session, expired
     on `SessionEnd`/timeout) or leave the gating out; do not assume the infrastructure is
     there.

## Acceptance criteria

- A single `driver` call switches the displayed view (verified on hardware, vendor app
  **not** running), with the byte layout documented in `driver.py` and this handoff.
- The HUD auto-switches to ELLI on idle/stop and back to the card on activity, with **no
  full re-upload** for the switch (the images already live in flash). Multi-session
  gating ("only when no other session is live") is **not** required for v1 — it depends on
  the session registry called out in step 5; without it, last-writer-wins is acceptable.
- `set_view` degrades gracefully (never raises, no-ops if unsupported) and stays off the
  hook hot path — same detached-process + best-effort-lock discipline as the rest of the
  sink. `python -m pytest packages/keyboard_hud` stays green incl. import-safety.
- The one-time sniffing harness is **not** committed (throwaway); only the confirmed
  command + findings land in the repo.

## Fallback (if no host view-select command exists)

It's entirely possible the firmware only switches views via the knob and never over HID.
In that case:
- **Re-upload to the live slot.** The HUD already does this — writing an image to the
  active slot *is* the switch. Cost is a full frame upload (~11–17s for an animation,
  <1s for a single-frame card). Acceptable for an idle→ELLI transition; too slow for
  snappy flips. Document this as the supported path and **close the programmatic-switch
  idea explicitly** rather than leaving it dangling.
- Consider making ELLI a **single still frame** for the screensaver so the flip-in is
  sub-second, keeping the 36-frame animation for manual (knob) viewing.

## Gotchas

- **Single-instance mutex:** the vendor app must be running to *sniff* it but must be
  *closed* to test our replay (it'll otherwise re-assert its own view/state). Sequence
  the two phases; don't run both at once.
- **Wired only:** view/state behavior can differ over BLE/2.4G; capture and test in
  wired mode to match how the HUD talks to the device.
- **Channel discipline:** control commands go as **feature reports on `0xFF13`**; never
  send a view command as a bulk output report on `0xFF68` (that channel is pages-only —
  see the driver's hard safety guard).
- **Don't brick the menu graphics.** The upload path has a 141-frame cap because
  overflowing the image slot corrupts adjacent flash (menu graphics). A view-select
  command shouldn't touch flash, but treat any *unknown* opcode conservatively while
  probing — log-and-replay known-shaped frames, don't fuzz.
- **Elevation is one-time and scoped:** it's needed only for the capture phase against
  `DeviceDriver.exe`. Our runtime driver + HUD need no elevation (raw HID already works
  unprivileged in this environment).

## Out of scope

Per-key direct RGB, multi-session screen aggregation, and any change to the card or
ELLI artwork — separate tracks. This handoff is only about *switching which stored view
the screen shows, from code.*
