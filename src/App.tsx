import { useEffect, useMemo, useState } from 'react';
import type { FeatureCollection, Polygon, MultiPolygon, LineString, MultiLineString } from 'geojson';
import { AtlasMap } from './components/AtlasMap';
import { DEMO_SPEED_MPS, useSimulateDrive } from './hooks/useSimulateDrive';
import { useAnnounceEngine } from './hooks/useAnnounceEngine';
import { useGps } from './hooks/useGps';
import {
  setMuted,
  isMuted,
  cancelSpeech,
  unlockAndChirp,
  getAudioStatusLabel,
  getVoiceCount,
  BEEP_EVENT,
  refreshVoices,
  VOICES_EVENT,
  getEnglishVoices,
  getPreferredVoiceURI,
  setPreferredVoice,
  getCurrentVoiceName,
  testVoice,
  type VoiceOption,
} from './lib/speech';
import type { StreamProps, WatershedProps } from './lib/types';
import './App.css';

type SpeedMult = 0.5 | 1 | 2;

export default function App() {
  const [watersheds, setWatersheds] = useState<FeatureCollection<
    Polygon | MultiPolygon,
    WatershedProps
  > | null>(null);
  const [streams, setStreams] = useState<FeatureCollection<
    LineString | MultiLineString,
    StreamProps
  > | null>(null);
  const [route, setRoute] = useState<FeatureCollection<LineString> | null>(null);
  const [mutedState, setMutedState] = useState(false);
  const [blurbs, setBlurbs] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [speedMult, setSpeedMult] = useState<SpeedMult>(1);
  const [caption, setCaption] = useState<{ id: string; title: string; detail?: string } | null>(null);
  const [captionExpanded, setCaptionExpanded] = useState(false);
  const [audioLabel, setAudioLabel] = useState('TTS: …');
  const [audioFlash, setAudioFlash] = useState(false);
  const [voiceOptions, setVoiceOptions] = useState<VoiceOption[]>([]);
  const [voicePref, setVoicePref] = useState<string>('');
  const [voiceName, setVoiceName] = useState<string | null>(null);

  const { position, setPosition, simulating, progress, finished, toggle, stop } =
    useSimulateDrive({ speedMps: DEMO_SPEED_MPS * speedMult });

  useGps(!simulating && position.source !== 'simulate', setPosition);

  const routeCoords = useMemo(() => {
    const c = route?.features[0]?.geometry.coordinates;
    return (c as [number, number][] | undefined) ?? null;
  }, [route]);

  const { activeWatershed, events, lastStreamNear, upcoming, reset: resetEngine } =
    useAnnounceEngine({
      watersheds,
      streams,
      routeCoords,
      position,
      blurbsEnabled: blurbs,
    });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [w, s, r] = await Promise.all([
          fetch(import.meta.env.BASE_URL + 'data/watersheds.geojson').then((x) => x.json()),
          fetch(import.meta.env.BASE_URL + 'data/streams.geojson').then((x) => x.json()),
          fetch(import.meta.env.BASE_URL + 'data/demo-route.geojson').then((x) => x.json()),
        ]);
        if (cancelled) return;
        setWatersheds(w);
        setStreams(s);
        setRoute(r);
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : 'Failed to load map data');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Voice list is async on Chromium — refresh chip when voices arrive
  useEffect(() => {
    const update = () => setAudioLabel(getAudioStatusLabel());
    update();
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    window.speechSynthesis.addEventListener('voiceschanged', update);
    const t = window.setTimeout(update, 800);
    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', update);
      window.clearTimeout(t);
    };
  }, []);

  // Voice picker: refresh when the voice list loads / selection changes
  useEffect(() => {
    const sync = () => {
      setVoiceOptions(getEnglishVoices());
      setVoicePref(getPreferredVoiceURI() ?? '');
      setVoiceName(getCurrentVoiceName());
    };
    refreshVoices();
    sync();
    window.addEventListener(VOICES_EVENT, sync);
    const t = window.setTimeout(() => {
      refreshVoices();
      sync();
    }, 1000);
    return () => {
      window.removeEventListener(VOICES_EVENT, sync);
      window.clearTimeout(t);
    };
  }, []);

  const onVoiceChange = (uri: string) => {
    setPreferredVoice(uri || null);
    setVoicePref(uri);
    setVoiceName(getCurrentVoiceName());
  };

  // Visible AUDIO flash on every beep (remote desktop often drops Chromium audio)
  useEffect(() => {
    const onBeep = () => {
      setAudioFlash(true);
      window.setTimeout(() => setAudioFlash(false), 450);
    };
    window.addEventListener(BEEP_EVENT, onBeep);
    return () => window.removeEventListener(BEEP_EVENT, onBeep);
  }, []);

  // Compact on-screen caption for each announcement (works with or without TTS)
  useEffect(() => {
    if (events.length === 0) return;
    const latest = events[0];
    setCaption({ id: latest.id, title: latest.title, detail: latest.detail });
    setCaptionExpanded(false);
  }, [events]);

  // Auto-dismiss: ~4.5 s collapsed, ~9 s if the user tapped to expand
  useEffect(() => {
    if (!caption) return;
    const t = window.setTimeout(() => setCaption(null), captionExpanded ? 9000 : 4500);
    return () => window.clearTimeout(t);
  }, [caption, captionExpanded]);

  const onMute = () => {
    const next = !isMuted();
    setMuted(next);
    setMutedState(next);
  };

  const onSimulate = async () => {
    if (simulating) {
      // Stopping — no unlock needed
      await toggle();
      return;
    }
    // Clear prior queue BEFORE unlock so we do not cancel the priming utterance
    resetEngine();
    cancelSpeech();
    setCaption(null);
    // User gesture: unlock TTS + resume AudioContext + immediate test chirp
    unlockAndChirp();
    refreshVoices();
    setAudioLabel(getAudioStatusLabel());
    await toggle();
  };

  const onReset = () => {
    stop();
    resetEngine();
    cancelSpeech();
    setCaption(null);
  };

  const activeName = activeWatershed?.properties.name ?? '—';
  const area =
    activeWatershed?.properties.area_sqmi != null
      ? `${activeWatershed.properties.area_sqmi} sq mi`
      : null;

  const pct = Math.round(progress * 100);
  const statusLabel = simulating
    ? `Simulating… ${pct}%`
    : finished
      ? 'Done — tap Simulate to replay'
      : position.source === 'gps'
        ? 'GPS live'
        : 'Idle · tap Simulate';

  const showUpcoming =
    simulating || position.source === 'simulate' || Boolean(finished);

  const voiceN = getVoiceCount();
  const audioChipClass =
    voiceN > 0 ? 'audio-chip ok' : 'audio-chip warn';

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden>
            ◈
          </span>
          <div>
            <h1>Aural Atlas</h1>
            <p className="tagline">Hydrologist&apos;s aural atlas announcer</p>
          </div>
        </div>
        <div className="chip-row">
          <div
            className={audioChipClass}
            title="Web Speech voices / beep fallback. Remote desktop may not forward Chromium audio — watch for AUDIO flash."
          >
            {audioLabel}
          </div>
          <div
            className={`status-chip ${simulating ? 'live' : ''} ${finished && !simulating ? 'done' : ''}`}
          >
            {statusLabel}
          </div>
        </div>
      </header>

      <main className="main">
        <div className="map-wrap">
          <AtlasMap
            watersheds={watersheds}
            streams={streams}
            route={route}
            activeWatershed={activeWatershed}
            position={position}
            simulating={simulating}
          />
          {audioFlash && (
            <div className="audio-flash" role="status" aria-live="assertive">
              AUDIO
            </div>
          )}
          {caption && (
            <div
              key={caption.id}
              className={`announce-banner ${captionExpanded ? 'expanded' : ''}`}
              role="status"
              aria-live="polite"
              onClick={() => setCaptionExpanded((v) => !v)}
              title={caption.detail ? `${caption.title} · ${caption.detail}` : caption.title}
            >
              <span className="announce-dot" aria-hidden>
                ♪
              </span>
              <span className="announce-body">
                <span className="announce-text">{caption.title}</span>
                {caption.detail && (
                  <span className="announce-detail">{caption.detail}</span>
                )}
              </span>
            </div>
          )}
          {simulating && (
            <div className="sim-progress" aria-hidden>
              <div className="sim-progress-bar" style={{ width: `${pct}%` }} />
              <span className="sim-progress-label">{pct}%</span>
            </div>
          )}
          {loadError && <div className="banner error">{loadError}</div>}
        </div>

        <aside className="panel">
          <section className="card active-ws">
            <h2>Active watershed</h2>
            <p className="big">{activeName}</p>
            {blurbs && area && <p className="meta">{area}</p>}
            {(simulating || position.source === 'simulate') && (
              <p className="meta hud-coords" style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.85rem' }}>
                {position.lat.toFixed(5)}, {position.lon.toFixed(5)}
              </p>
            )}
            {lastStreamNear && (
              <p className="meta stream">Near: {lastStreamNear}</p>
            )}
            {simulating && (
              <p className="meta progress-meta">Route progress: {pct}%</p>
            )}
          </section>

          {showUpcoming && (
            <section className="card upcoming" aria-live="polite">
              <h2>Upcoming</h2>
              {upcoming.nextStream ? (
                <p className="upcoming-row stream">
                  <span className="upcoming-kind">Stream</span>
                  <span className="upcoming-name">{upcoming.nextStream.name}</span>
                  <span className="upcoming-dist">
                    {formatDist(upcoming.nextStream.meters)}
                  </span>
                </p>
              ) : (
                <p className="upcoming-row muted-row">
                  <span className="upcoming-kind">Stream</span>
                  <span className="upcoming-name">—</span>
                </p>
              )}
              {upcoming.nextWatershed ? (
                <p className="upcoming-row watershed">
                  <span className="upcoming-kind">Watershed</span>
                  <span className="upcoming-name">
                    Enter {upcoming.nextWatershed.name}
                  </span>
                  <span className="upcoming-dist">
                    {formatDist(upcoming.nextWatershed.meters)}
                  </span>
                </p>
              ) : (
                <p className="upcoming-row muted-row">
                  <span className="upcoming-kind">Watershed</span>
                  <span className="upcoming-name">—</span>
                </p>
              )}
            </section>
          )}

          <section className="controls">
            <button
              type="button"
              className={`btn primary ${simulating ? 'running' : ''}`}
              onClick={onSimulate}
            >
              {simulating ? 'Stop' : 'Simulate drive'}
            </button>
            <button
              type="button"
              className={`btn ${mutedState ? 'muted' : ''}`}
              onClick={onMute}
              aria-pressed={mutedState}
            >
              {mutedState ? 'Unmute' : 'Mute'}
            </button>
            <button type="button" className="btn ghost" onClick={onReset}>
              Reset
            </button>
          </section>

          <div className="speed-row" role="group" aria-label="Simulation speed">
            <span className="speed-label">Speed</span>
            {([0.5, 1, 2] as SpeedMult[]).map((m) => (
              <button
                key={m}
                type="button"
                className={`btn speed ${speedMult === m ? 'active' : ''}`}
                onClick={() => setSpeedMult(m)}
                aria-pressed={speedMult === m}
              >
                {m}×
              </button>
            ))}
          </div>

          <section className="voice-row" aria-label="Voice">
            <label className="voice-label" htmlFor="voice-select">
              Voice
            </label>
            <select
              id="voice-select"
              className="voice-select"
              value={voicePref}
              onChange={(e) => onVoiceChange(e.target.value)}
              disabled={voiceOptions.length === 0}
            >
              <option value="">
                {voiceOptions.length === 0
                  ? 'No voices found (device default)'
                  : `Auto (best: ${voiceOptions[0].name})`}
              </option>
              {voiceOptions.map((v) => (
                <option key={v.uri} value={v.uri}>
                  {v.name} · {v.lang}
                  {v.local ? '' : ' · online'}
                </option>
              ))}
            </select>
            <button type="button" className="btn ghost voice-test" onClick={testVoice}>
              Test voice
            </button>
            <p className="voice-hint">
              For the most natural iPhone voice, download an Enhanced/Premium voice in
              Settings &gt; Accessibility &gt; Spoken Content &gt; Voices.
              {voiceName ? ` Now using: ${voiceName}.` : ''}
            </p>
          </section>

          <label className="toggle">
            <input
              type="checkbox"
              checked={blurbs}
              onChange={(e) => setBlurbs(e.target.checked)}
            />
            <span>Attribute blurbs (area / name)</span>
          </label>

          <section className="card log">
            <h2>Announcements</h2>
            {events.length === 0 ? (
              <p className="empty">
                Start <strong>Simulate drive</strong> for a Pali→Windward demo
                (~90–120 s at 1×). Expect Lulumahu then Nuuanu→Kaneohe by ~25%.
                Captions + a soft chime always fire (TTS only when voices exist).
                Use the layers button on the map to switch Topo / Relief / Streets.
              </p>
            ) : (
              <ul>
                {events.map((ev) => (
                  <li key={ev.id} data-kind={ev.kind}>
                    <span className="kind">{labelKind(ev.kind)}</span>
                    <span className="text">
                      {ev.title}
                      {ev.detail ? ` · ${ev.detail}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <p className="footnote">
            Data: HI Statewide GIS CWRM watersheds + NHD named flowlines (Oʻahu
            clip). Basemap © OpenStreetMap. Demo route is canned (starts near
            Pali crest) — no invented discharge/rainfall. Mute silences TTS +
            chime; a compact caption always shows (~4.5 s, tap to expand). AUDIO tag confirms chimes
            even when speakers / remote-desktop audio are silent.
          </p>
        </aside>
      </main>
    </div>
  );
}

function labelKind(kind: string) {
  if (kind === 'watershed-enter') return 'ENTER';
  if (kind === 'watershed-leave') return 'LEAVE';
  return 'STREAM';
}

function formatDist(meters: number) {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${meters} m`;
}
