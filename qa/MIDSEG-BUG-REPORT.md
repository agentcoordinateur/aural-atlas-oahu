# FAIL — mid-segment RAF restart (useSimulateDrive.ts)

**Verdict: CONFIRMED FAIL** (independent headless replay, 2026-09-15 PT)

## Symptom
Progress % climbs to 100 while lat/lon stay ~1.5 m from the route start. `idx` never leaves 0.

## Root cause
In the RAF `frame` loop, when travel distance for the frame is **less than the current segment length**, the code interpolates a point from the **segment start vertex**, then:

- sets `idxRef.current = idx` (unchanged — still at segment start)
- sets `carryRef.current = 0` (discards how far into the segment we already are)
- adds `remain` into `traveledRef` anyway

Next frame restarts from the same vertex. Median demo-route segment ≈ **40 m**; per-frame travel at 90 m/s × 1/60 s ≈ **1.5 m**. So the vehicle never finishes a segment; progress still accumulates.

## Headless proof (`qa/midseg-bug-proof.json`)
| Metric | Value |
| --- | --- |
| Route | 226 verts, ~8989 m |
| Final progress | **100%** |
| Final idx | **0** |
| Dist from route start | **~1.5 m** |
| Dist from route end | **~7652 m** |

Sample: at t=0.5s progress≈0.5%, same lon/lat as t=0; at t=129s progress=100%, idx still 0, same coords.

## Suggested fix
Track **distance along the current segment** (or continuous distance along the whole route), not only vertex index:

1. **Preferred:** keep `alongSegRef` (meters already consumed on `coords[idx]→coords[idx+1]`). On each frame, `remain = speed*dt`; advance `alongSeg` / step `idx` when `alongSeg >= segLen`; interpolate with `t = alongSeg / segLen`. Set progress from total traveled along path.
2. **Or:** on mid-segment exit, set `carryRef = -distanceAlreadyIntoSegment` / store fractional offset — current `carry=0` is wrong.
3. **Or:** rebuild each frame from a single `traveledRef` cursor into precomputed cumulative distances (binary search + interpolate) — eliminates carry bugs entirely.

Do **not** treat camera soft-pan (FIX-MARKER) as the fix for this; that is a separate bug. This one is pure motion state.

## Code locus
`src/hooks/useSimulateDrive.ts` — mid-segment branch inside `frame` (~lines 127–144): `carryRef.current = 0` after interpolating from `a`.

---

## Update (same session) — FIXED in tree

Source no longer uses idx + `carryRef = 0`. Current `useSimulateDrive.ts` keeps a sole along-track `traveledRef` and calls `advanceAlongPath` from `src/lib/simulatePath.ts`.

- Headless replay of **new** math: **PASS** (`qa/postfix-path-proof.json`) — progress 100%, idx advances, 0 stuck windows.
- Live browser Simulate (~2%→36%): marker crawled, trail grew, Nuuanu→Kaneohe + stream captions — **PASS** (screenshots under agent assets). Soft-pan / fitBounds also OK.

Prior FAIL still stands as the pre-fix diagnosis; do not reopen unless someone reintroduces vertex-restart carry.
