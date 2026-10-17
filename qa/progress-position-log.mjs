#!/usr/bin/env node
/**
 * Offline QA: prove simulate progress % and geographic position advance together.
 * Replicates useSimulateDrive pose math at DEMO_SPEED_MPS=90, fixed dt=1/60.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DEMO_SPEED_MPS = 90;
const DT = 1 / 60;
const MAX_T = 120;
const LOG_EVERY_S = 0.5;
const LOG_EVERY_M = 50;

function haversineMeters(aLon, aLat, bLon, bLat) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const φ1 = toRad(aLat);
  const φ2 = toRad(bLat);
  const Δφ = toRad(bLat - aLat);
  const Δλ = toRad(bLon - aLon);
  const s =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

function buildCum(coords) {
  const cum = [0];
  let total = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    total += haversineMeters(
      coords[i][0],
      coords[i][1],
      coords[i + 1][0],
      coords[i + 1][1],
    );
    cum.push(total);
  }
  return { cum, total };
}

function poseAt(coords, cum, along) {
  const total = cum[cum.length - 1] || 1;
  const d = Math.max(0, Math.min(along, total));
  if (d <= 0) {
    return { lon: coords[0][0], lat: coords[0][1] };
  }
  let i = 0;
  while (i < cum.length - 2 && cum[i + 1] < d) i++;
  const a = coords[i];
  const b = coords[Math.min(i + 1, coords.length - 1)];
  const segStart = cum[i];
  const segLen = Math.max(1e-6, cum[i + 1] - segStart);
  const t = (d - segStart) / segLen;
  return {
    lon: a[0] + (b[0] - a[0]) * t,
    lat: a[1] + (b[1] - a[1]) * t,
  };
}

const geoPath = join(ROOT, 'public/data/demo-route.geojson');
const fc = JSON.parse(readFileSync(geoPath, 'utf8'));
const coords = fc.features[0].geometry.coordinates;
const { cum, total } = buildCum(coords);
const first = coords[0];
const last = coords[coords.length - 1];
const expectedDurationS = total / DEMO_SPEED_MPS;

const rows = [];
let along = 0;
let t = 0;
let lastLogT = -Infinity;
let lastLogAlong = -Infinity;
let prevLat = first[1];
let prevLon = first[0];

// Initial sample at t=0
{
  const pose = poseAt(coords, cum, 0);
  rows.push({
    t_s: 0,
    progress_pct: 0,
    lat: pose.lat,
    lon: pose.lon,
    delta_m_from_prev: 0,
  });
  lastLogT = 0;
  lastLogAlong = 0;
  prevLat = pose.lat;
  prevLon = pose.lon;
}

while (along < total && t < MAX_T) {
  // Match useSimulateDrive: dt capped at 0.05; here fixed 1/60 < 0.05
  along = Math.min(total, along + DEMO_SPEED_MPS * DT);
  t += DT;
  const pose = poseAt(coords, cum, along);
  const progress = along / total;
  const shouldLog =
    t - lastLogT >= LOG_EVERY_S - 1e-9 ||
    along - lastLogAlong >= LOG_EVERY_M - 1e-9 ||
    along >= total;

  if (shouldLog) {
    const delta_m = haversineMeters(prevLon, prevLat, pose.lon, pose.lat);
    rows.push({
      t_s: Number(t.toFixed(4)),
      progress_pct: Number((progress * 100).toFixed(4)),
      lat: pose.lat,
      lon: pose.lon,
      delta_m_from_prev: Number(delta_m.toFixed(4)),
    });
    prevLat = pose.lat;
    prevLon = pose.lon;
    lastLogT = t;
    lastLogAlong = along;
  }
}

// Stuck-position assertion: any window where progress rises ≥1% but position moves <1m
const stuckFailures = [];
for (let i = 1; i < rows.length; i++) {
  const dPct = rows[i].progress_pct - rows[i - 1].progress_pct;
  const dM = rows[i].delta_m_from_prev;
  if (dPct >= 1 && dM < 1) {
    stuckFailures.push({
      from_i: i - 1,
      to_i: i,
      from_t: rows[i - 1].t_s,
      to_t: rows[i].t_s,
      dPct,
      dM,
      from_progress: rows[i - 1].progress_pct,
      to_progress: rows[i].progress_pct,
    });
  }
}

const finalPose = poseAt(coords, cum, along);
const progressFinal = (along / total) * 100;
const atLastVertex =
  Math.abs(finalPose.lat - last[1]) < 1e-5 &&
  Math.abs(finalPose.lon - last[0]) < 1e-5;
const reached100 = progressFinal >= 99.99 && along >= total - 1e-6;
const pass = stuckFailures.length === 0 && reached100 && atLastVertex;

const outDir = join(ROOT, 'qa');
mkdirSync(outDir, { recursive: true });
const logPath = join(outDir, 'progress-position-log.jsonl');
writeFileSync(logPath, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');

const summary = {
  pass,
  DEMO_SPEED_MPS,
  route_length_m: total,
  route_length_km: total / 1000,
  expected_duration_s: expectedDurationS,
  sim_duration_s: t,
  n_samples: rows.length,
  first_coords: { lon: first[0], lat: first[1] },
  last_coords: { lon: last[0], lat: last[1] },
  final_pose: finalPose,
  progress_final_pct: progressFinal,
  reached_100: reached100,
  position_at_last_vertex: atLastVertex,
  stuck_failures: stuckFailures,
};

console.log(JSON.stringify(summary, null, 2));
console.log(`\nWrote ${rows.length} rows → ${logPath}`);
console.log(pass ? 'ASSERT: PASS' : 'ASSERT: FAIL');
if (stuckFailures.length) {
  console.error('Stuck windows:', stuckFailures);
}
process.exitCode = pass ? 0 : 1;
