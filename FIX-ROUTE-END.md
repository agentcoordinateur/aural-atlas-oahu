# Demo route end fix (2026-09-15 PT)

## Problem

Simulate could hit **100%** while **Active watershed** stayed **Nuuanu** and Upcoming kept showing **Enter Kaneohe · 2.3 km**. That distance is exactly the along-track offset from the trimmed Pali start to the Nuuanu→Kaneohe crest (~2.28 km) — i.e. the cursor still looked like the route **start**, not the finish.

Two stacked causes:

1. **Route end / perception:** After the pacing trim (`FIX-PACING.md`), the canned path did reach Windward on disk, but finishing in Heeia while Upcoming/snap still emphasized “Enter Kaneohe · 2.3 km” near the start made a failed run look like “route never leaves Nuuanu.”
2. **Simulate pose vs progress:** An index/segment walker could advance `traveled` / progress while the published lon/lat lagged or stuck near the start (progress→100% with Lulumahu still in range). See also `src/lib/simulatePath.ts`.

## Fix

### 1. Demo route (`public/data/demo-route.geojson`)

- Keep early **Lulumahu** approach in the first ~10–15% (start still ~231 m from Lulumahu Stream).
- **Nuuanu → Kaneohe** at **~20.3%** (~2.28 km) — well under the 40–50% ceiling.
- Continue Windward (Kawa / Keaahala / Heeia), then a short SE extension so the **final vertex is inside Kaneohe** (not Nuuanu).
- Length ≈ **11.2 km**, 242 vertices. No invented hydrology attributes — only the canned track was edited.

### 2. Distance-based simulate (`src/lib/simulatePath.ts` + `useSimulateDrive`)

- Along-track meters are the sole source of truth; each frame uses `advanceAlongPath` → `pointAtDistance`.
- Progress and marker lon/lat cannot diverge; finish when `traveled >= total`.

## Scripted check (after)

| Checkpoint | Result |
| --- | --- |
| Start watershed | Nuuanu |
| Lulumahu ≤280 m at 0% | ~231 m |
| First ENTER Kaneohe | **20.3%** |
| 100% watershed | **Kaneohe** |
| Headless 2× sim | Moves; ends done; end WS ≠ Nuuanu |

Event timeline (along-track %):

| Event | % |
| --- | ---: |
| ENTER Nuuanu + STREAM Lulumahu | ~0% |
| LEAVE Nuuanu → ENTER Kaneohe | **~20%** |
| Kawa / Kaneohe / Keaahala / Heeia | ~43–75% |
| End in Kaneohe | **100%** |

## Success

- At route end, active watershed is **Kaneohe** (or another Windward unit), **not Nuuanu**.
- Kaneohe enter announcement fires during the run (~20%).
- Marker edge-follow, captions, and beeps unchanged.
