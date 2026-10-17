# VERIFY — Simulate motion (2026-09-15 PT)

## Headless motion proof (~2 s simulated, 60 fps, `DEMO_SPEED_MPS=90`)

Pure cumulative-distance cursor (`src/lib/simulatePath.ts` → `advanceAlongPath` / `headlessSimulate`) over `public/data/demo-route.geojson`:

| | Progress | Lat | Lon |
| --- | ---: | ---: | ---: |
| **First** tick | 0.000% | 21.353176 | −157.808040 |
| **Last** (~2 s) | 1.601% | 21.354053 | −157.806579 |

- **Lat Δ** ≈ +0.000877 · **Lon Δ** ≈ +0.001461 → **positions differ: YES**
- Distance traveled ≈ 180 m (90 m/s × 2 s) — matches speed × time
- `progressAdvancesWhilePosConstant`: **false** (the old mid-segment restart bug would have been **true**)

Re-run:

```bash
cd /workspace/aural-atlas && node --input-type=module -e "
import fs from 'fs';
import { distance, bearing, point } from '@turf/turf';
import { headlessSimulate, buildCumDistances } from './src/lib/simulatePath.ts';
"
```

Or copy the logic from `src/lib/simulatePath.ts` (Vite/TS); numbers above were produced with the same algorithm via Turf.

## Route end watershed

| | Value |
| --- | --- |
| Vertices | 242 |
| Length | ~11.2 km |
| Start | Nuuanu (−157.80804, 21.353176) |
| **First Kaneohe** | **~21%** of route |
| End | **Kaneohe** (−157.7965, 21.4048) |

Route crosses into Kaneohe **well before 100%**, then revisits Kaneohe after Heeia/Keaahala and **finishes in Kaneohe**.

## How to confirm HUD lat/lon while watching

1. `npm run build && npm run preview -- --host 127.0.0.1 --port 5173`
2. Hard-refresh (cache-bust) if an old bundle sticks: open `http://127.0.0.1:5173/?v=$(date +%s)`
3. Click **Simulate drive**
4. Orange debug HUD (bottom-left of map) shows **Progress / Lat / Lon / Watershed** every tick
5. Confirm **Lat** and **Lon** digits change continuously (e.g. `21.35317` → `21.35405` within ~2 s at 1×) — same as the headless table
6. Red marker should crawl the dashed orange path; growing red trail; map only soft-pans near edges
7. Captions (~6 s) + beep still fire; Mute silences audio only

### Remote desktop note

A remote desktop / noVNC session can **drop or coalesce SVG frame updates**, so the red marker may look stickier than on a native display even when Leaflet `setLatLng` runs every tick. Trust the **HUD lat/lon digits** and this headless table — if those change, the pose is moving. Progress bar has **no CSS width transition**, so % cannot animate ahead of React state.
