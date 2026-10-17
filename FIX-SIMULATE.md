# Simulate drive fixes (2026-09-15)

What changed so Simulate is obviously working on screen (including silent Linux Chromium).

## Critical bug

- **`useSimulateDrive` RAF early-exit:** when the first animation frame had `dt ≈ 0`, `remain` was 0, the movement `while` was skipped, and the handler fell through to `setProgress(1)` + `setSimulating(false)` — the run finished instantly (map jumped to Heeia; a few ENTER/LEAVE lines appeared).
- **Fix:** if the path index is still mid-route, schedule another RAF and return; only mark finished when the last coordinate is reached. Also skip zero-`dt` frames without treating them as completion.

## Timing & controls

- Default demo speed is **`DEMO_SPEED_MPS = 155`** so Honolulu→Kaneohe (~16.4 km canned route) takes **~90–120 s at 1×** (time-compressed; not real highway speed).
- Optional **0.5× / 1× / 2×** speed buttons (live via a speed ref).

## Visible motion

- While simulating, map **zooms to ~14–15** and **FollowUser always pans** when `source === 'simulate'`.
- Larger red marker (radius 14) plus a soft **pulse ring**.

## TTS + captions

- On Simulate click (user gesture): **`unlockSpeech()`** (resume + silent utterance) to prime Chromium.
- **Large “Now announcing: …” banner** for every announcement (~3.5 s), always — Mute only stops audio. Captions are the reliable demo path when `getVoices()` is empty (common on Linux boxes).

## Status UI

- Big **Simulating… N%** chip + map progress bar while running.
- Primary button becomes **Stop** while running.
- After finish: **Done — tap Simulate to replay**.

## Docs

- README notes Linux may lack TTS voices; captions are the demo path.
- No hydrology attributes were invented; GIS extracts unchanged.
