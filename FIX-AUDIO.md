# FIX-AUDIO — Aural Atlas audible path (2026-09-16 PT)

## Diagnosis (Chromium CDP @ `http://127.0.0.1:5173/`)

| Check | Result |
|---|---|
| `typeof speechSynthesis` | `"object"` |
| `speechSynthesis.getVoices().length` | **0 on first paint**, then **19** after `voiceschanged` (async load) |
| Mute | Off (`Mute` button, `aria-pressed=false`) |
| `AudioContext` | Present; new contexts start **`suspended`** until a user gesture calls `resume()` |
| Simulate click | Starts sim; announcements + captions fire |
| Beep before fix | Easy to miss: gain peak was **0.18** sine; unlock then **`cancelSpeech()`** raced and cancelled the priming utterance |
| Box speakers | **No local audio output** — see below |

### Box / remote-desktop audio

- `/dev/snd` — **missing**
- `/proc/asound` — **missing**
- `pactl` / `aplay` — **not installed**
- Chrome still runs an `audio.mojom.AudioService` process, but there is **no ALSA device** for real playback on this box.
- The user listens via **remote-desktop handoff** of the box. Many RD paths **do not forward Chromium audio** even when Web Audio “succeeds” in-process.

**Implication:** “No sound” is often an **environment / RD forwarding** issue, not only an app bug. The app must still (1) unlock + resume AudioContext on Simulate, (2) play a loud test chirp + announce beeps, and (3) show a **visible AUDIO flash** so demos are verifiable without speakers.

## Root causes fixed

1. **AudioContext resume must happen in the Simulate click gesture** — later RAF announces cannot reliably unsuspend audio.
2. **Race:** `onSimulate` called `unlockSpeech()` then `cancelSpeech()`, which cancelled the priming TTS utterance. Order is now: `cancelSpeech` → `unlockAndChirp()` (unlock + resume + test chirp).
3. **Beep too quiet / soft waveform** — switched to **square** wave, peak gain **~0.55–0.6**, slightly longer envelope.
4. **0 voices initially** — still call `speechSynthesis.speak()`; always beep; chip updates on `voiceschanged`.
5. **RD silent audio** — dispatch `aural-atlas-beep` and show a large yellow **AUDIO** flash (~450 ms) on every chirp/beep.

## Code changes

- `src/lib/speech.ts`
  - `ensureAudioCtxSync()`, louder `playAnnounceBeep()`, `playTestChirp()`, `unlockAndChirp()`
  - `BEEP_EVENT`, `getAudioStatusLabel()` / `getVoiceCount()` / `refreshVoices()`
  - Always beep (+ flash) in `announce`; still attempt TTS even with 0 voices
- `src/App.tsx`
  - Simulate start: cancel → unlockAndChirp → start (no cancel after unlock)
  - Audio status chip: `TTS: N voices` or `TTS unavailable — beeps on`
  - Listen for `BEEP_EVENT` → AUDIO flash overlay
- `src/App.css` — `.audio-chip`, `.audio-flash`, pop animation

## Verify

- Rebuilt (`npm run build`) and preview restarted on **`:5173`** (assets `index-Bu9x1-jz.js` / `index-fwY9r26k.css`).
- CDP after reload:
  - Chip: **`TTS: 19 voices`**
  - On **Simulate drive**: event log got `kind: "test"` then `kind: "announce"`; DOM showed **`AUDIO`** flash within ~150 ms
  - Captions + announcement list updated (Nuuanu enter, Lulumahu stream)

## Success criteria

| Criterion | Status |
|---|---|
| Real TTS when voices exist | Available after async load (19 voices here); speak still attempted |
| Loud beeps on each announce | Yes (square ~0.55) + AUDIO flash |
| Test chirp on Simulate start | Yes (`unlockAndChirp`) + AUDIO flash |
| Document no / RD-missing audio | Yes — no `/dev/snd`; RD may drop Chromium audio; flash is the reliable cue |

**If you still hear nothing remotely:** watch for the yellow **AUDIO** flash and on-screen captions — that confirms the app fired audio; the silence is almost certainly RD/speakers, not a missing announce.
