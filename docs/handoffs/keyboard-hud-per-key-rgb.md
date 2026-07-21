# Handoff: per-key direct RGB lighting

**Status:** ready-for-agent — **investigation, not blocked on admin elevation** (unlike the
view-switch handoff: raw HID already works unprivileged in this environment for lighting +
LCD, and the per-key opcode family is already public via research; what's missing is
hardware replay to pin down the exact data-frame chunking, not a sniff of the elevated
vendor app). See `docs/agents/triage-labels.md`.
**Area:** `packages/keyboard_hud/driver.py` (`AulaS75`) + a throwaway hardware-replay script
(not committed).
**Depends on:** nothing open. Independent of the view-switch handoff (`docs/handoffs/keyboard-hud-view-switch.md`).
**Est. size:** small-medium — protocol is largely known from research; the work is confirming
byte-level details against the real S75 and adding one driver method + tests.

## Goal

Add **per-key direct RGB** to `driver.py` — set an arbitrary color per physical key in one
shot, instead of only the 20 built-in whole-keyboard effects `set_mode()` already supports.
This unlocks true per-key HUD signaling (e.g. highlight specific key zones) beyond the
screen + whole-board lighting we have today.

## What's already known (from research, not yet verified on our hardware)

The S75 Pro shares its driver/firmware family with the AULA F108 Pro (same VID/PID
`0x0C45`/`0x800A`), documented in `parsiya/f108-pro`'s `ai-docs/hid-protocol.md`
(reversed from the vendor app's Ghidra decompilation) and cross-referenced against
`hcode10/OpenRGB-With-AulaF108Pro-support`. Per that source, per-key lighting is a variant
of the same `04 18` (begin) → data → `04 02` (apply) → `04 F0` (finalize) sequence
`set_mode()` already uses, with a different init/data shape:

- **Init packet** (feature report on `0xFF13`, after `04 18`): `Byte[0]=0x04, Byte[1]=0x23,
  Byte[2]=0x03` (monochrome) or **`0x09`** (RGB) — this replaces the `04 13` light-init
  byte sequence `set_mode()` sends.
- **Data payload:**
  - RGB mode: **4 bytes per key** — `light_index, R, G, B` — total **576 bytes**
    (~144 key slots on the F108's larger layout; the S75's `rgb-keyboard.xml` only
    populates **80** of them, `light_index` values 1–120 with gaps — use that file as the
    authoritative index map for which slots exist on *our* board, not the F108's count).
  - Monochrome mode: **1 byte per key** — `light_index`, `0xFF`=on/`0x00`=off — 192 bytes.
  - Both are described as "multi-packet" in the source with no further detail on chunking.
- **Correction to prior notes:** an earlier note in project memory said the opcode was
  `04 20` with a "2s keepalive." Neither holds up against this source: the opcode is
  **`04 23`**, and **no keepalive/resend mechanism is documented anywhere** in the
  `f108-pro` protocol notes or the OpenRGB fork — treat the "2s keepalive" claim as
  unconfirmed folklore until/unless a capture shows otherwise. Direct-mode RGB apps
  commonly re-send on every color *change*, which is easy to mistake for a periodic
  keepalive; that's the more likely explanation if the board does need repeated frames.

## Open questions (why this isn't just "type in the bytes")

1. **Chunking mechanism, unconfirmed.** `set_mode()`'s lighting data is a single 64-byte
   feature report. LCD upload instead pages 4096-byte chunks over the **bulk** `0xFF68`
   channel. Per-key data (192–576 bytes) doesn't fit one 64-byte feature report but is
   much smaller than an LCD page — is it several sequential 64-byte **feature** reports on
   `0xFF13` (most likely, given it's still a "lighting" command family), or does it reuse
   the bulk channel like LCD does? The source doesn't say. Get this wrong and the command
   either no-ops or (per the doc) is silently ignored — low risk, but wastes cycles
   guessing blind.
2. **Trailer placement, unconfirmed for this payload shape.** `set_mode()`'s single-packet
   data ends with the `0x55AA` (LE) trailer at bytes 14–15 of its one 64-byte packet. For a
   *multi-packet* per-key payload it's unclear whether the trailer appears once (last
   packet only), per-packet, or not at all — needs a hardware round-trip to see what the
   keyboard actually accepts vs. silently drops.
3. **`light_index` numbering confirmation.** `rgb-keyboard.xml`'s `light_index` values are
   assumed to be exactly the indices this command expects (same family, same driver
   generation) but that's inference, not a confirmed byte-for-byte match — verify by
   lighting one specific key and checking it's the *right* key, not an adjacent one.

## Approach

1. **Minimal single-key test (no admin needed).** Using the raw HID access already proven
   in this environment (`AulaS75(open_lcd=False)`), send `04 18` → `04 23` (byte[2]=`0x09`)
   → a single 64-byte feature report carrying one `(light_index, R, G, B)` tuple padded
   with zeros → `04 02` → `04 F0`, mirroring `set_mode()`'s call shape exactly. Pick a
   `light_index` from `rgb-keyboard.xml` for an easily-identified key (e.g. `Esc`,
   `light_index="1"`) and a saturated color. Observe the physical keyboard.
2. **If nothing lights up:** try the payload as multiple sequential 64-byte feature reports
   (one tuple per report) before falling back to a bulk-channel attempt — feature-report
   chunking is the cheaper, lower-risk guess given this is still framed as a lighting
   command in the source.
3. **If the wrong key lights up:** the index mapping assumption (question 3) is wrong —
   capture which index actually corresponds to which key by scanning `light_index` 1..N
   and noting what lights, then reconcile against the XML.
4. **Scale to all-keys.** Once one key works, build the full 576-byte (or however many
   populated `light_index` slots exist on the S75) payload from a `{light_index: (r,g,b)}`
   dict and confirm multi-key frames render correctly and that unlisted indices stay off.
5. **Ship it.** Add `set_per_key(colors: dict[int, tuple[int,int,int]])` to `driver.py`
   (same 35ms `CMD_DELAY` discipline, same `_feature()` helper, no new safety-critical
   paths — per-key stays on the feature-report channel, never touches the LCD's
   flash-writing bulk path). Load the S75's key-name → `light_index` map from
   `rgb-keyboard.xml` (or a small baked-in constant derived from it) so callers can address
   keys by name.

## Acceptance criteria

- `AulaS75.set_per_key({...})` lights the correct keys with the correct colors, verified on
  hardware, with the byte layout (opcode, init byte, chunking, trailer placement) documented
  in `driver.py` and this handoff, replacing the "unconfirmed" language above with what was
  actually observed.
- A key-name-to-`light_index` helper exists so callers don't hardcode raw indices.
- `python -m pytest packages/keyboard_hud` stays green incl. import-safety (no new hidapi
  hard dependency at import time).
- The throwaway single-key/scan test script is **not** committed; only the confirmed
  protocol + the shipped method land in the repo.

## Gotchas

- **Don't guess blind past the single-key test.** Per the source, a malformed per-key frame
  is *silently ignored* (unlike a malformed LCD page, which can overflow flash and
  permanently damage the menu graphics) — but "probably harmless" isn't "verified harmless
  on this exact firmware," so confirm the single-key case fully before scaling to a full
  576-byte frame.
- **Channel discipline still applies.** If step 2 ends up needing the bulk channel, that
  path already carries the LCD's hard safety guards (output reports only, page-1 ACK
  fail-fast) — don't bypass those guards for per-key data without the same care.
- **Don't conflate F108 key count with S75 key count.** The 576-byte/144-slot figure is the
  F108's; the S75 is a smaller board — use `rgb-keyboard.xml`'s own 80 populated
  `light_index` entries as the source of truth for what to send, not the F108 numbers.
- **If a keepalive turns out to be real**, wire it as a background resend loop analogous to
  nothing else in this driver today — don't assume `set_mode()`'s one-shot pattern extends
  cleanly; scope that as a follow-up once confirmed rather than guessing a 2s timer now.

## Out of scope

The programmatic view-switch (separate handoff) and any change to the LCD/ELLI artwork.
This handoff is only about *lighting individual keys with arbitrary colors from code*.
