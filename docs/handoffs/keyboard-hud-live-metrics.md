# Handoff: live tokens + elapsed on the keyboard HUD

**Status:** ready-for-agent
**Area:** `packages/keyboard_hud`
**Depends on:** PR #29 (keyboard HUD sink) — merged or branched from `feat/keyboard-hud`
**Est. size:** small (one parser + one wiring passthrough + tests)

## Goal

Populate the HUD status card's stat rows with **live session metrics** — cumulative token
usage and elapsed time — so the card reads e.g.

```
WORKING
Refactor auth middleware
Tokens      112k
Elapsed     9:41
```

Today those stat values are hard-coded only in the `__main__` demo of the old standalone
`hud.py`; the real sink renders with an **empty** `stats` dict, so no rows appear in practice.

## Current state (what already exists)

- `notifier.map_event(data)` maps a raw Claude Code hook event → a directive
  `{state, title, stats, footer, screen}`. It is **pure and fast** (no file IO) and currently
  sets `stats={}`.
- `notify(data)` spawns a **detached** `python -m packages.keyboard_hud.apply <directive-json>`.
- `apply.py` reads the directive, opens the keyboard, and calls
  `render.render_hud(state, title, stats=directive["stats"], footer=...)`. `render_hud` already
  renders every `{label: value}` pair in `stats` as a right-aligned row — so **filling `stats`
  is all that's needed to make rows appear.**

## Why this needs transcript parsing

Claude Code hook payloads do **not** include token counts. They do include:
- `transcript_path` — absolute path to the session transcript (JSONL, one message per line)
- `session_id`
- `cwd`, `hook_event_name`, etc.

Tokens must be summed from the transcript; elapsed is derived from message timestamps.

## Approach (keep the hot path clean)

Do the parsing in **`apply.py`** (the detached process, off the hook's critical path) — **not**
in `map_event`/`notify`, which must stay pure and fast.

1. **`notifier.map_event`**: pass `transcript_path` through on screen-rendering events (prompt,
   Notification, Stop, SessionStart). Add it under a private key so it isn't mistaken for a
   display field, e.g. `directive["_transcript"] = data.get("transcript_path", "")`. Do **no**
   file IO here. `PostToolUse` is lights-only (`screen=False`) — skip it, no metrics needed.
2. **`apply.py`**: before rendering, if `_transcript` is set and the screen will render, call a
   new `metrics(transcript_path) -> dict` and merge its result into `stats`
   (`stats = {**metrics(...), **directive.get("stats", {})}`). Wrap in try/except — on any
   failure leave `stats` as-is (card just shows fewer rows). This stays inside the existing
   best-effort lock + change-detection block.
3. **`metrics(path)`**: read the JSONL, return `{"Tokens": "<human>", "Elapsed": "<m:ss>"}`.

### Token sum
Assistant message lines carry `message.usage`. Sum across all assistant entries:
`input_tokens + output_tokens + cache_creation_input_tokens + cache_read_input_tokens`
(guard missing keys with `.get(..., 0)`; skip non-assistant / usage-less lines). Format with a
`k`/`M` helper (e.g. `112000 -> "112k"`).

### Elapsed
Each JSONL entry has an ISO-8601 `timestamp`. `elapsed = now - min(timestamp)`. Prefer the
earliest transcript timestamp (stateless, robust) over tracking SessionStart in a state file.
Format `m:ss`, rolling to `h:mm:ss` past an hour. Use timezone-aware parsing
(`datetime.fromisoformat`; normalise `Z` → `+00:00`).

## Files to change

| File | Change |
|------|--------|
| `packages/keyboard_hud/notifier.py` | add `_transcript` passthrough in `map_event` (screen events only) |
| `packages/keyboard_hud/apply.py` | add `metrics()` + `_fmt_tokens()` + `_fmt_elapsed()`; merge into `stats` before render |
| `packages/keyboard_hud/tests/test_notifier.py` | assert `_transcript` passthrough present on screen events, absent/ignored on `PostToolUse` |
| `packages/keyboard_hud/tests/test_metrics.py` (new) | parser tests against a small fixture JSONL |

## Acceptance criteria

- With a real `transcript_path`, the card shows non-empty **Tokens** and **Elapsed** rows.
- `metrics()` never raises: missing file, malformed line, empty transcript, missing `usage`,
  and missing `timestamp` all degrade gracefully (omit the affected row, never crash).
- Parsing stays in the detached process; `map_event`/`notify` do no file IO and stay
  synchronous. `pnpm test` (pytest) green, incl. import-safety without hidapi/Pillow.
- A malformed/huge transcript does not stall the updater noticeably (bound the read if needed;
  full read is fine for typical sessions).

## Test fixture sketch (`tests/fixtures/transcript.jsonl`)

```jsonl
{"type":"assistant","timestamp":"2026-07-21T09:00:00Z","message":{"usage":{"input_tokens":1000,"output_tokens":500,"cache_read_input_tokens":2000}}}
{"type":"user","timestamp":"2026-07-21T09:00:30Z"}
{"type":"assistant","timestamp":"2026-07-21T09:09:41Z","message":{"usage":{"input_tokens":1200,"output_tokens":800}}}
```
Expected: Tokens = 1000+500+2000+1200+800 = 5500 → `"5k"` (or `"5.5k"` if you keep one decimal);
Elapsed relative to `min(timestamp)`.

## Gotchas

- Token field names/casing can vary by Claude Code version — `.get()` defensively; don't assume
  every assistant line has `usage`.
- `transcript_path` may be absent on some events — treat as "no metrics", not an error.
- One physical keyboard, N concurrent sessions ⇒ last-writer-wins (existing behaviour): the
  metrics shown are the most recent session's, not an aggregate. Fine for v1; note it.
- Keep everything stderr-only under `OCTOWIZ_VERBOSE`; never print to stdout.

## Out of scope

Per-key RGB, multi-session aggregation, and cost ($) estimation — separate follow-ups.
