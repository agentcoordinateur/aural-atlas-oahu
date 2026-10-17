# Aural Atlas — SUMMARY (for parent agent)

## Status

Runnable Vite + React + TypeScript prototype at `/workspace/aural-atlas`.  
`npm run build` **succeeds**. Preview: `http://127.0.0.1:5173/`.

## Latest fix (frozen marker / % only)

Smoking gun: simulate RAF restarted each mid-segment from the vertex (`carry=0`) so % advanced while lat/lon stayed put. Fixed with cumulative-distance cursor (`simulatePath.ts`). Imperative `setLatLng` + growing trail + live lat/lon HUD. Route extended to finish in Kaneohe (~21% first entry). See `FIX-MARKER.md`, `VERIFY.md`. Remote desktop may coalesce SVG frames — trust HUD digits.

## Latest fix (route end + pose)

Simulate could show 100% still in **Nuuanu** with Upcoming **Enter Kaneohe · 2.3 km**. Demo route now ends in **Kaneohe** (Nuuanu→Kaneohe ~20%); simulate pose is distance-based (`simulatePath.ts`) so progress and lon/lat stay locked. See `FIX-ROUTE-END.md` (also `FIX-MARKER.md`, `FIX-PACING.md`).

## Data used

| File | Real vs synthetic | Source |
| --- | --- | --- |
| `public/data/watersheds.geojson` | **Real** (87 polygons, simplified) | HI Statewide GIS CWRM Watersheds (FreshWater/MapServer/8), Oʻahu bbox clip |
| `public/data/streams.geojson` | **Real** (60 named GNIS streams) | HI Statewide GIS NHD Flowlines (layer 10), named only, Oʻahu clip + corridor preference |
| `public/data/demo-route.geojson` | **Canned** project route | Pali crest → Windward; ends in Kaneohe (route-end fix) |

No synthetic watershed/stream fallback was needed — downloads succeeded. No invented discharge/rainfall.

## How to demo

```bash
cd /workspace/aural-atlas && npm run preview -- --host 127.0.0.1 --port 5173
```

1. Open the app → **Simulate drive**
2. Red marker **crawls** the orange route (not glued to center); trail visible
3. Expect Lulumahu early, Nuuanu→Kaneohe by ~20%; at **100%** active WS is Kaneohe (not Nuuanu)
4. Captions (~6 s) + beep always; TTS when voices exist; Mute silences TTS + beep only
5. Active watershed highlighted yellow on OSM map

## Blockers

None for local demo. Linux Chromium often lacks TTS voices — captions + beep cover that.

## Key paths

- App: `src/App.tsx`
- Map: `src/components/AtlasMap.tsx`
- Announce / speech: `src/hooks/useAnnounceEngine.ts`, `src/lib/speech.ts`
- Simulate: `src/hooks/useSimulateDrive.ts`
- Docs: `README.md`, `FIX-ROUTE-END.md`, `FIX-MARKER.md`, `FIX-PACING.md`, `FIX-SIMULATE.md`
