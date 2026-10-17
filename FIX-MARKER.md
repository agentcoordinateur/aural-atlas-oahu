# Marker crawl + captions/beeps (2026-09-15 PT)

## CRITICAL — % advanced while marker looked frozen

### Smoking-gun root cause (simulate pose)

In `useSimulateDrive`, the RAF loop partially consumed a segment (`else` branch), then set `carry=0` and left `idx` at the **segment start**. The next frame restarted from that vertex again. `traveledRef += remain` every frame → **progress % climbed to 100%** while lon/lat stayed ~`speed*dt` meters from the same vertex. Marker appeared frozen; only the counter moved.

### Fix (pose)

**Cumulative-distance cursor** (`src/lib/simulatePath.ts`): each tick advances `traveled` meters along the full route and derives lon/lat/heading from `pointAtDistance`. Never restarts a mid-segment from its start vertex. See `VERIFY.md` headless proof.

### Fix (map follow / marker)

1. **On Simulate start:** `fitBounds` on the demo route (padding, `maxZoom` ~13.5).
2. **During simulate:** soft-pan only when the marker enters an **~18% edge buffer**. Marker must crawl relative to the orange path.
3. **Imperative marker:** `markerRef.current.setLatLng()` (and pulse / heading) in `useLayoutEffect` every pose change — do not rely on CircleMarker `center` prop alone.
4. **Growing trail:** full red polyline of visited positions for the run.
5. **Live debug HUD:** progress %, lat, lon, watershed — always visible during simulate.
6. **Pace:** `DEMO_SPEED_MPS = 90` (~11 km ≈ ~2 min at 1× after Kaneohe extension).

GPS / live mode still centers with `panTo`.

### CSS progress bar

Removed `transition: width` on `.sim-progress-bar` so the bar cannot animate independently of marker/HUD updates.

## Remote desktop / noVNC display

Yes — a remote desktop session **can look different** from a local browser:

- Frame coalescing / low FPS can make SVG CircleMarker motion look sticky or stepped.
- Tile pan animation may stutter while the HUD digits still update smoothly.
- Web Audio beeps may be silent or delayed; captions remain the reliable announce path.

**If only the map looks frozen:** check the orange HUD lat/lon. Changing digits = pose is advancing (and Leaflet `setLatLng` is being called). Compare with `VERIFY.md` headless numbers.

## No audio (Linux Chromium)

- Keep `unlockSpeech()` on Simulate (user gesture).
- Captions: larger, ~**6 s**, strong border/glow.
- Short **Web Audio beep** on each `announce()`.
- Mute silences TTS + beep; captions always show.

## Route

Extended SE from Heeia into **Kaneohe** so the demo finishes in Kaneohe; first Kaneohe entry ~**21%**.

## Success check

Headless: position changes with progress. Watching: HUD lat/lon changes every tick; marker `setLatLng` each tick; route in Kaneohe before 100%; captions + beeps fire.
