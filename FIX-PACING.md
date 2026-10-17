# Demo pacing fix (2026-09-15 PT)

## Problem

Simulate felt empty for the first third+: users reached ~37–41% still in **Nuuanu** with only the initial ENTER caption. Marker moved, but no stream approaches / watershed leaves yet.

## Investigation (before)

Canned route: downtown Honolulu → Pali → Kaneohe / Heeia (~16.4 km, 266 verts).

| Event | % of route | Along-track |
| --- | ---: | ---: |
| ENTER Nuuanu | 0% | 0 m |
| STREAM Pauoa (≤200 m) | ~9.5% | ~1.6 km |
| STREAM Nuʻuanu | ~23.5% | ~3.9 km |
| STREAM Lulumahu | ~43.5% | ~7.1 km |
| LEAVE Nuuanu → ENTER Kaneohe | **~59%** | ~9.7 km |
| Later Windward streams / basins | 75%+ | — |

So a user at ~40% was still deep in Nuuanu with no watershed change yet. Early stream approaches were also easy to miss: approach radius 200 m + single 900 m heading lookahead + 90 s cooldown is strict on a winding corridor (GNIS lines often sit just off-axis of heading).

## Fix (combo)

1. **Trimmed demo route** (`public/data/demo-route.geojson`)  
   Starts upper Nuuanu near **Lulumahu / Pali approach** (~7.4 km into the old path), still ends Windward (Heeia). ~9.0 km.

2. **Loosened stream approach (demo-friendly, still real GIS)**  
   - Approach radius 200 → **280 m**  
   - Multi-step heading lookahead 400 / 800 / **1200 m**  
   - Along-route lookahead samples (helps winding Pali)  
   - Cooldown 90 s → **45 s**  
   - Move tick 25 → **20 m**

3. **Upcoming UI** while simulating  
   Next named stream + next watershed enter with distance (from precomputed route cues over real watersheds/streams). Captions + progress unchanged.

No invented hydrology attributes.

## Event timeline (after)

Approach 280 m, multi-step + along-route assist; trimmed ~9.0 km route.

| Event | % of route | Notes |
| --- | ---: | --- |
| ENTER Nuuanu | 0% | Start |
| STREAM Lulumahu | **~0%** | Immediately in range (~231 m) |
| LEAVE Nuuanu → ENTER Kaneohe | **~25.4%** | Pali crest |
| STREAM Kamoʻoaliʻi | ~35% | Windward (with loosened approach) |
| Kawa / Kaneohe wobble | ~55–64% | Real polygon edges |
| Kapunahala / Keaʻahala / Heeia | 67%+ | End of demo |

## Success

A fresh **Simulate drive** yields a visible **stream** announcement and a **watershed leave/enter** by ~25% progress, with Upcoming showing the next cues before they fire.
