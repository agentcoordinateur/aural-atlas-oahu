/** Web Speech + Web Audio announcer for Aural Atlas.
 *
 *  - A soft synthesized bell (Web Audio) precedes each announcement.
 *  - Speech is queued: new announcements never cancel or silently drop one
 *    that is in progress. The queue is short and coalesces stale items.
 *  - Reliability workarounds (iOS Safari + Chrome):
 *      * unlock speechSynthesis + AudioContext on the first user gesture
 *      * never speak in the same tick the chime / AudioContext starts —
 *        speech is scheduled after the chime with setTimeout
 *      * keep strong references to live utterances (Chrome GC drops onend)
 *      * pick a voice once voices load (voiceschanged)
 *      * resume() watchdog for Chrome's ~15 s auto-pause bug
 *      * retry once on onerror, or if speech never starts within ~1.5 s
 *      * hard timeout so a lost onend can never jam the queue
 *  - Captions are always shown by the UI regardless of TTS. */

let muted = false;
let audioCtx: AudioContext | null = null;
let voicesCache: SpeechSynthesisVoice[] = [];
let chosenVoice: SpeechSynthesisVoice | null = null;
let unlockCount = 0;

export const BEEP_EVENT = 'aural-atlas-beep';

/** Delay between the chime and speech start (lets the bell ring first). */
const CHIME_LEAD_MS = 420;
/** If onstart has not fired by then, retry once. */
const START_TIMEOUT_MS = 1500;
/** Keep at most this many pending (not yet spoken) announcements. */
const MAX_PENDING = 6;
/** Pending items are joined into one utterance (fewer gaps, nothing lost). */
const MAX_JOIN = 2;

interface QueueItem {
  text: string;
  attempts: number;
  id: number;
}

const queue: QueueItem[] = [];
let current: { item: QueueItem; utt: SpeechSynthesisUtterance; started: boolean } | null = null;
/** Strong refs so Chrome does not garbage-collect utterances mid-speech. */
const liveUtterances = new Set<SpeechSynthesisUtterance>();
let startTimer: number | undefined;
let hardTimer: number | undefined;
let scheduleTimer: number | undefined;
let resumeTimer: number | undefined;
let nextId = 1;

/** Lightweight event log (inspected by QA scripts via window.__aaoSpeech). */
const log: { t: number; ev: string; text?: string; info?: string }[] = [];
function note(ev: string, text?: string, info?: string) {
  log.push({ t: Date.now(), ev, text, info });
  if (log.length > 200) log.shift();
}

function synth(): SpeechSynthesis | null {
  if (typeof window === 'undefined') return null;
  return window.speechSynthesis ?? null;
}

const isIOS =
  typeof navigator !== 'undefined' &&
  (/iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

function emitBeepFlash(kind: 'announce' | 'test' = 'announce') {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(BEEP_EVENT, { detail: { kind, at: Date.now() } }));
  } catch {
    // ignore
  }
}

function getAC(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null;
  return (
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ||
    null
  );
}

/** Create/resume the AudioContext synchronously (works inside a user gesture). */
function ensureAudioCtxSync(): AudioContext | null {
  const AC = getAC();
  if (!AC) return null;
  try {
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === 'suspended') void audioCtx.resume();
    return audioCtx;
  } catch {
    return null;
  }
}

/**
 * Gentle bell: sine fundamental + a few soft inharmonic partials, fast soft
 * attack, exponential decay. Gentle low-pass keeps it from sounding tinny.
 */
function ringBell(ctx: AudioContext, at: number, f0: number, peak: number, decay = 1.3) {
  const master = ctx.createGain();
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 2600;
  lp.Q.value = 0.5;
  master.gain.value = peak;
  master.connect(lp);
  lp.connect(ctx.destination);

  // [ratio, relative gain, decay scale]: bell-like inharmonic series
  const partials: [number, number, number][] = [
    [1, 1, 1],
    [2.0, 0.22, 0.6],
    [2.76, 0.12, 0.45],
    [5.4, 0.035, 0.25],
  ];
  for (const [ratio, g, dScale] of partials) {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f0 * ratio, at);
    const d = Math.max(0.2, decay * dScale);
    env.gain.setValueAtTime(0.0001, at);
    env.gain.linearRampToValueAtTime(g, at + 0.012); // soft, quick attack
    env.gain.exponentialRampToValueAtTime(0.0001, at + d);
    osc.connect(env);
    env.connect(master);
    osc.start(at);
    osc.stop(at + d + 0.05);
  }
}

/** Soft bell before each announcement (~587 Hz, ~1.3 s decay). */
let lastBellAt = 0;
export function playAnnounceBeep() {
  if (muted) return;
  emitBeepFlash('announce');
  // Back-to-back announcements (leave + enter) share one bell.
  const now = Date.now();
  if (now - lastBellAt < 700) return;
  lastBellAt = now;
  try {
    const ctx = ensureAudioCtxSync();
    if (!ctx) return;
    ringBell(ctx, ctx.currentTime + 0.01, 587.33, 0.2, 1.3);
  } catch {
    // captions remain the reliable path
  }
}

/** Two-note soft chime on Simulate start (confirms audio is unlocked). */
export function playTestChirp() {
  if (muted) return;
  emitBeepFlash('test');
  try {
    const ctx = ensureAudioCtxSync();
    if (!ctx) return;
    const t0 = ctx.currentTime + 0.01;
    ringBell(ctx, t0, 523.25, 0.16, 1.0);
    ringBell(ctx, t0 + 0.18, 659.25, 0.16, 1.2);
  } catch {
    // ignore
  }
}

function pickVoice() {
  const s = synth();
  if (!s) return;
  try {
    voicesCache = s.getVoices();
  } catch {
    voicesCache = [];
  }
  if (voicesCache.length === 0) {
    chosenVoice = null;
    return;
  }
  const lang = (typeof navigator !== 'undefined' && navigator.language) || 'en-US';
  const en = voicesCache.filter((v) => v.lang?.toLowerCase().startsWith('en'));
  chosenVoice =
    en.find((v) => v.lang === lang && v.localService) ||
    en.find((v) => v.lang === 'en-US' && v.localService) ||
    en.find((v) => v.localService) ||
    en.find((v) => v.default) ||
    en[0] ||
    voicesCache.find((v) => v.default) ||
    null;
}

let voicesListenerInstalled = false;
function installVoicesListener() {
  const s = synth();
  if (!s || voicesListenerInstalled) return;
  voicesListenerInstalled = true;
  try {
    s.addEventListener('voiceschanged', pickVoice);
  } catch {
    // ignore
  }
  pickVoice();
}

/** Call from a user gesture (Simulate / first tap) to unlock TTS + AudioContext. */
export function unlockSpeech() {
  ensureAudioCtxSync();
  installVoicesListener();
  const s = synth();
  if (!s) return;
  try {
    s.resume();
    if (!current) {
      // Short silent utterance primes iOS / Chrome while inside the gesture.
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      u.rate = 2;
      liveUtterances.add(u);
      const drop = () => liveUtterances.delete(u);
      u.onend = drop;
      u.onerror = drop;
      window.setTimeout(drop, 3000);
      s.speak(u);
      unlockCount += 1;
      note('unlock', undefined, String(unlockCount));
    }
    pickVoice();
  } catch {
    // ignore
  }
}

/** Unlock + soft confirmation chime (Simulate start). */
export function unlockAndChirp() {
  unlockSpeech();
  playTestChirp();
}

/** Also unlock on the very first tap/click anywhere on the page. */
if (typeof window !== 'undefined') {
  const once = () => {
    unlockSpeech();
    window.removeEventListener('pointerdown', once, true);
    window.removeEventListener('touchend', once, true);
    window.removeEventListener('keydown', once, true);
  };
  window.addEventListener('pointerdown', once, true);
  window.addEventListener('touchend', once, true);
  window.addEventListener('keydown', once, true);
  installVoicesListener();
}

export function refreshVoices(): number {
  pickVoice();
  return voicesCache.length;
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
  return 'TTS unavailable — chime on';
}

export function getAudioContextState(): string {
  return audioCtx?.state ?? 'none';
}

function clearTimers() {
  if (startTimer) window.clearTimeout(startTimer);
  if (hardTimer) window.clearTimeout(hardTimer);
  startTimer = undefined;
  hardTimer = undefined;
}

function stopResumeWatchdog() {
  if (resumeTimer) window.clearInterval(resumeTimer);
  resumeTimer = undefined;
}

/** Chrome pauses long speech after ~15 s; nudge it. On iOS pause/resume
 *  can itself stall speech, so there we only resume() if it reports paused. */
function startResumeWatchdog() {
  if (resumeTimer) return;
  resumeTimer = window.setInterval(() => {
    const s = synth();
    if (!s) return;
    if (!s.speaking && !s.pending) return;
    if (s.paused) {
      s.resume();
      note('watchdog-resume');
    } else if (!isIOS) {
      s.pause();
      s.resume();
    }
  }, 10_000);
}

function finish(reason: string) {
  if (!current) return;
  note(reason, current.item.text);
  liveUtterances.delete(current.utt);
  current = null;
  clearTimers();
  if (queue.length === 0) stopResumeWatchdog();
  scheduleNext(120);
}

function retryOrDrop(reason: string) {
  if (!current) return;
  const { item, utt } = current;
  liveUtterances.delete(utt);
  current = null;
  clearTimers();
  if (item.attempts < 2) {
    note('retry', item.text, reason);
    queue.unshift(item);
    const s = synth();
    // A stuck engine needs a cancel before it will accept new speech.
    if (s && (s.speaking || s.pending)) {
      try {
        s.cancel();
      } catch {
        // ignore
      }
    }
    scheduleNext(250);
  } else {
    note('give-up', item.text, reason);
    scheduleNext(120);
  }
}

function scheduleNext(delay: number) {
  if (scheduleTimer) window.clearTimeout(scheduleTimer);
  scheduleTimer = window.setTimeout(() => {
    scheduleTimer = undefined;
    speakNext();
  }, delay);
}

function speakNext() {
  if (muted || current || queue.length === 0) return;
  const s = synth();
  if (!s) {
    queue.length = 0;
    return;
  }
  let item = queue.shift()!;
  // Join a couple of fresh pending items (e.g. "Leaving A. Entering B.")
  if (item.attempts === 0) {
    let joined = 1;
    while (joined < MAX_JOIN && queue.length > 0 && queue[0].attempts === 0) {
      const nxt = queue.shift()!;
      item = { ...item, text: `${item.text} ${nxt.text}` };
      joined += 1;
    }
  }
  item.attempts += 1;
  const u = new SpeechSynthesisUtterance(item.text);
  u.rate = 1.0;
  u.pitch = 1;
  u.volume = 1;
  if (chosenVoice) {
    u.voice = chosenVoice;
    u.lang = chosenVoice.lang;
  } else {
    u.lang = 'en-US';
  }
  const entry = { item, utt: u, started: false };
  current = entry;
  liveUtterances.add(u);

  u.onstart = () => {
    if (current !== entry) return;
    entry.started = true;
    note('start', item.text);
  };
  u.onend = () => {
    if (current !== entry) return;
    finish('end');
  };
  u.onerror = (e: SpeechSynthesisErrorEvent) => {
    if (current !== entry) return;
    const err = e?.error ?? 'unknown';
    if (err === 'interrupted' || err === 'canceled') {
      finish(`error-${err}`);
    } else {
      retryOrDrop(`error-${err}`);
    }
  };

  try {
    if (s.paused) s.resume();
    s.speak(u);
    note('speak', item.text, `attempt ${item.attempts}`);
  } catch (err) {
    retryOrDrop(`throw-${String(err)}`);
    return;
  }
  startResumeWatchdog();

  // Never started → retry once (iOS sometimes swallows the first speak).
  startTimer = window.setTimeout(() => {
    if (current !== entry || entry.started) return;
    const st = synth();
    // Some engines speak without firing onstart; trust .speaking.
    if (st?.speaking && !st.pending) {
      entry.started = true;
      return;
    }
    retryOrDrop('no-start');
  }, START_TIMEOUT_MS);

  // Hard ceiling so a lost onend can never jam the queue.
  const est = 4000 + item.text.length * 110;
  hardTimer = window.setTimeout(() => {
    if (current !== entry) return;
    finish('hard-timeout');
  }, est);
}

export function setMuted(value: boolean) {
  muted = value;
  if (muted) cancelSpeech();
}

export function isMuted() {
  return muted;
}

export function announce(text: string) {
  // Chime first (always) — speech follows after the chime, never same tick.
  playAnnounceBeep();
  if (muted) return;
  if (!synth()) {
    console.info('[TTS unavailable]', text);
    return;
  }
  // When speech is backed up, "Entering B" implies leaving A: drop stale pending
  // "Leaving" lines so the voice stays current. (No backlog: "Leaving A. Entering B." is joined.)
  if (/^Entering /.test(text) && queue.length >= 2) {
    for (let i = queue.length - 1; i >= 0; i--) {
      if (/^Leaving /.test(queue[i].text) && queue[i].attempts === 0) {
        note('implied-drop', queue[i].text);
        queue.splice(i, 1);
      }
    }
  }
  // Safety cap only (rare): drop the oldest *pending* item, never the one speaking.
  while (queue.length >= MAX_PENDING) {
    const dropped = queue.shift();
    note('coalesce-drop', dropped?.text);
  }
  queue.push({ text, attempts: 0, id: nextId++ });
  note('enqueue', text);
  if (!current && !scheduleTimer) scheduleNext(CHIME_LEAD_MS);
}

/** Explicit stop (Reset / Mute / new Simulate run): the only place we cancel. */
export function cancelSpeech() {
  queue.length = 0;
  if (scheduleTimer) window.clearTimeout(scheduleTimer);
  scheduleTimer = undefined;
  clearTimers();
  stopResumeWatchdog();
  if (current) liveUtterances.delete(current.utt);
  current = null;
  const s = synth();
  if (s && (s.speaking || s.pending)) {
    try {
      s.cancel();
    } catch {
      // ignore
    }
  }
  note('cancel');
}

/** Debug/QA hook. */
export function getSpeechDebug() {
  return {
    log: [...log],
    pending: queue.map((q) => q.text),
    current: current?.item.text ?? null,
    voices: voicesCache.length,
    voice: chosenVoice?.name ?? null,
    audioCtx: getAudioContextState(),
  };
}

if (typeof window !== 'undefined') {
  (window as unknown as { __aaoSpeech?: unknown }).__aaoSpeech = { getSpeechDebug, announce };
}
