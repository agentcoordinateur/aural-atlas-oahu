# Aural Atlas

**Hydrologist's aural atlas announcer** — a driving-oriented web prototype for Oʻahu that speaks when you enter or leave a watershed and when you approach a GNIS-named stream.

Audio-first (Web Speech API), phone-friendly controls, OSM basemap, and a **Simulate drive** mode so you can demo without GPS.

## Concept

While moving (real GPS or canned simulation), the app:

1. Detects the active **CWRM watershed** polygon under the vehicle and announces enter/leave.
2. Measures distance to **NHD named flowlines** and announces approaches (~200 m, with heading lookahead).
3. Highlights the active watershed on a Leaflet + OSM map.
4. Optionally appends attribute blurbs (name, area sq mi) — **never** invents discharge or rainfall.

## Quick start

```bash
cd /workspace/aural-atlas
npm install
npm run dev
```

Open the printed local URL (usually `http://localhost:5173`). For a production check:

```bash
npm run build
npm run preview
```

## Demo script (no GPS)

1. Allow speech if the browser prompts (Chrome/Edge work best).
2. Leave **Mute** off; leave **Attribute blurbs** on.
3. Tap **Simulate drive** — a canned Pali-crest → Kaneohe/Heeia route runs as a ~90–120 s time-compressed demo at 1× (use **0.5× / 1× / 2×** to change pace). Expect **Lulumahu** early, Nuuanu→Kaneohe by ~20%; route **ends in Kaneohe** (not Nuuanu). **Upcoming** shows next cues with distances.
4. Watch / listen for:
   - Entering **Nuuanu** watershed (start).
   - Approaches to streams such as **Lulumahu** (then Windward streams after the crest).
   - Leaving Nuuanu / entering **Kaneohe** (and further Windward units: Kawa, Keaahala, Heeia).
   - The **red marker crawling along the dashed orange route** (map soft-pans only near the edge — it does **not** glue the marker to screen center).
5. Tap **Mute** mid-run to confirm TTS + beep stop; **Unmute** resumes future announcements. Captions still appear when muted.
6. Confirm the yellow highlight tracks the active watershed; blue lines are named streams; dashed orange is the demo route.

Typical full simulate run is ~90–120 seconds at 1×. Large on-screen **Now announcing** captions (~6 s, hard to miss) always appear. A short **Web Audio beep** plays on each announce so something audible happens even when `speechSynthesis` has no voices (common on Linux Chromium). Mute silences TTS + beep only.

## Data provenance

| Layer | Source | Notes |
| --- | --- | --- |
| Watersheds | [Hawaii Statewide GIS — CWRM Watersheds](https://geodata.hawaii.gov/arcgis/rest/services/FreshWater/MapServer/8) | Surface-water hydrologic units; clipped to Oʻahu bbox ≈ 158.3°W–157.6°W, 21.2°N–21.75°N; geometries simplified for web. Attributes: `name`, `id` (WUC), `area_sqmi`, `name_hwn`. |
| Named streams | [Hawaii Statewide GIS — NHD Flowlines](https://geodata.hawaii.gov/arcgis/rest/services/FreshWater/MapServer/10) | Features with non-null `gnis_name`, Oʻahu clip; corridor + length prioritized (~60 streams). USGS NHD / GNIS names. |
| Basemap | OpenStreetMap tiles | © OpenStreetMap contributors. |
| Demo route | Project-authored | Pali approach → Windward path (starts near Lulumahu / crest; ends in Kaneohe) for offline demo pacing. See FIX-ROUTE-END.md. |

Files live in `public/data/`:

- `watersheds.geojson` — **real** (downloaded & trimmed)
- `streams.geojson` — **real** (downloaded & trimmed)
- `demo-route.geojson` — canned simulation track

If those downloads had failed, the README would document synthetic fallbacks. In this build, **real public data was used**.

Attribution: DLNR Commission on Water Resource Management; Hawaii Statewide GIS Program; USGS National Hydrography Dataset / GNIS; OpenStreetMap contributors.

## Tech

- Vite + React + TypeScript
- Leaflet / react-leaflet + OSM raster tiles
- Turf.js for point-in-polygon and distance-to-line
- Web Speech API (`speechSynthesis`) with mute + short queue; Web Audio beep fallback when voices are missing
- Smart polling: ~0.8 s near features / boundaries, ~2.5 s when far; also ticks every ~25 m of travel

## Limitations

- Watersheds are **State CWRM units**, not USGS HUC-8 (Hawaii HUC-8s are coarse island-scale; CWRM units are better for local driving narration).
- Stream geometries are simplified; approach distance is planar-approx meters, not surveyed channel distance.
- TTS quality and availability depend on the browser/OS; some mobile browsers require a user gesture before speech.
- **Linux / headless Chromium often has no `speechSynthesis` voices** — TTS may be silent. On-screen captions (~6 s) plus a short Web Audio beep are the reliable demo path (see `FIX-SIMULATE.md`, `FIX-MARKER.md`). Mute stops TTS + beep; captions always show.
- Real GPS works when Simulate is off, but accuracy varies; the canned route is the reliable demo path.
- No discharge, stage, or rainfall — only attributes present in the GIS extracts.

## Future: Capacitor / Expo

This SPA is structured for a thin native shell:

- **Capacitor**: wrap the Vite `dist/` build, request location permissions, keep Web Speech or swap to a native TTS plugin for background audio.
- **Expo**: reimplement the map with `react-native-maps` / MapLibre and port the announce engine; reuse the same GeoJSON under `assets/`.

Either path should keep Simulate drive for review builds without field GPS.

## License / use

Prototype for demonstration. Upstream GIS data retain their agency terms; OSM tiles follow OSM tile usage policy.
