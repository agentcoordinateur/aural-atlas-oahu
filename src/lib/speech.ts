/** Thin Web Speech API wrapper with mute + queue + unlock for Chromium.
 *  Linux / headless Chromium often has no speechSynthesis voices — captions
 *  + a short Web Audio beep are the reliable announce path.
 *  Remote-desktop handoffs often do not forward Chromium audio — we also
 *  dispatch a visual AUDIO flash so demos remain verifiable without speakers. */

let muted = false;
let speaking = false;
const queue: string[] = [];
let audioCtx: AudioContext | null = null;
let voicesCache = 0;

export const BEEP_EVENT = 'aural-atlas-beep';

function emitBeepFlash(kind: 'announce' | 'test' = 'announce') {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(
      new CustomEvent(BEEP_EVENT, { detail: { kind, at: Date.now() } }),
    );
  } catch {
    // ignore
  }
}

function getAC(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null;
  return (
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext ||
    null
  );
}

/**
 * Create/resume AudioContext synchronously inside a user gesture.
 * Oscillator scheduling must happen in the same turn as the click —
 * awaiting resume() can leave later announces suspended.
 */
function ensureAudioCtxSync(): AudioContext | null {
  const AC = getAC();
  if (!AC) return null;
  try {
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === 'suspended') {
      void audioCtx.resume();
    }
    return audioCtx;
  } catch {
    return null;
  }
}

/** Loud short chirp (square + higher gain). Always emits visual flash. */
export function playAnnounceBeep() {
  if (muted) return;
  emitBeepFlash('announce');
  if (typeof window === 'undefined') return;
  try {
    const ctx = ensureAudioCtxSync();
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(990, t0);
    osc.frequency.exponentialRampToValueAtTime(660, t0 + 0.12);
    // Peak ~0.55 — louder than the prior 0.18 sine
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.55, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.2);
  } catch {
    // captions + flash remain the reliable path
  }
}

/** Distinct two-tone test chirp for Simulate start (user gesture). */
export function playTestChirp() {
  if (muted) return;
  emitBeepFlash('test');
  if (typeof window === 'undefined') return;
  try {
    const ctx = ensureAudioCtxSync();
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const makeTone = (freq: number, start: number, dur: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(freq, t0 + start);
      gain.gain.setValueAtTime(0.0001, t0 + start);
      gain.gain.exponentialRampToValueAtTime(0.6, t0 + start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0 + start);
      osc.stop(t0 + start + dur + 0.02);
    };
    makeTone(740, 0, 0.1);
    makeTone(1175, 0.12, 0.12);
  } catch {
    // ignore
  }
}

/** Call from a user gesture (e.g. Simulate click) to unlock TTS + AudioContext. */
export function unlockSpeech() {
  if (typeof window === 'undefined') return;
  ensureAudioCtxSync();
  if (!window.speechSynthesis) return;
  try {
    window.speechSynthesis.resume();
    // Empty/short utterance primes the engine while still in the gesture stack
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    u.rate = 2;
    window.speechSynthesis.speak(u);
    refreshVoices();
  } catch {
    // ignore — captions + beep remain the reliable path
  }
}

/** Unlock + resume + immediate audible/visual test chirp (Simulate start). */
export function unlockAndChirp() {
  unlockSpeech();
  playTestChirp();
}

export function refreshVoices(): number {
  if (typeof window === 'undefined' || !window.speechSynthesis) {
    voicesCache = 0;
    return 0;
  }
  try {
    voicesCache = window.speechSynthesis.getVoices().length;
  } catch {
    voicesCache = 0;
  }
  return voicesCache;
}

export function hasSpeechVoices(): boolean {
  return refreshVoices() > 0;
}

export function getVoiceCount(): number {
  return refreshVoices();
}

export function getAudioStatusLabel(): string {
  const n = refreshVoices();
  if (n > 0) return `TTS: ${n} voices`;
  return 'TTS unavailable — beeps on';
}

export function getAudioContextState(): string {
  return audioCtx?.state ?? 'none';
}

export function setMuted(value: boolean) {
  muted = value;
  if (muted && typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.cancel();
    queue.length = 0;
    speaking = false;
  }
}

export function isMuted() {
  return muted;
}

function speakNext() {
  if (muted || speaking || queue.length === 0) return;
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  const text = queue.shift()!;
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.05;
  u.pitch = 1;
  u.onend = () => {
    speaking = false;
    speakNext();
  };
  u.onerror = () => {
    speaking = false;
    speakNext();
  };
  speaking = true;
  try {
    // Always attempt speak even with 0 voices — some builds still produce audio
    window.speechSynthesis.speak(u);
  } catch {
    speaking = false;
    speakNext();
  }
}

export function announce(text: string) {
  // Always beep (+ visual flash) first — works without TTS voices / remote audio
  playAnnounceBeep();
  if (muted) return;
  if (typeof window === 'undefined' || !window.speechSynthesis) {
    console.info('[TTS unavailable]', text);
    return;
  }
  queue.push(text);
  speakNext();
}

export function cancelSpeech() {
  queue.length = 0;
  speaking = false;
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}
