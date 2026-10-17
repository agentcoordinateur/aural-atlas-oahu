# Progress ↔ Position QA Report

**Result: SUPERSEDED — false PASS**  
**When:** 2026-09-15 20:17 HST (PT)  
**Correction:** 20:17+ PT — see `MIDSEG-BUG-REPORT.md` / `midseg-bug-proof.json`

## Why this PASS is invalid

`qa/progress-position-log.mjs` did **not** mirror `useSimulateDrive.ts`. It advanced a continuous `along` distance and called `poseAt(cumDist)` — the **correct** algorithm.

The live hook instead keeps vertex `idx`, interpolates from segment **start**, then sets `carryRef = 0`. Faithful replay of that loop:

| Metric | Faithful buggy loop | Ideal `along` script |
|--------|---------------------|----------------------|
| Final progress | 100% | 100% |
| Final idx | **0** | n/a (cumDist) |
| Dist from start | **~1.5 m** | ~9 km (at end) |
| Verdict | **FAIL** | misleading PASS |

Authoritative artifact: `qa/MIDSEG-BUG-REPORT.md`.

## What the ideal script still shows

If the fix uses a traveled-distance cursor (as this script does), progress and lat/lon advance together: route **8.989 km**, ~**99.88 s** @ 90 m/s, 0 stuck windows. Treat that as the **post-fix acceptance** harness, not a current-code pass.

## Static map checks (still valid)

EDGE_BUFFER soft-pan, keyed CircleMarker, trail, FitRouteOnSimulate, `DEMO_SPEED_MPS===90` — present. `FIX-SIMULATE.md` still stale (155 / always pan).
