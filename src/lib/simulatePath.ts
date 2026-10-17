import { bearingDegrees, haversineMeters, pointAtDistance } from './geo';

export interface PathPose {
  lon: number;
  lat: number;
  heading: number;
  traveled: number;
  progress: number;
  done: boolean;
}

/** Build cumulative distances (meters) for a [lon,lat][] path. */
export function buildCumDistances(coords: [number, number][]): {
  cum: number[];
  total: number;
} {
  const cum: number[] = [0];
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

/** Heading along the segment that contains `along` meters. */
export function headingAtDistance(
  coords: [number, number][],
  cum: number[],
  along: number,
): number {
  if (coords.length < 2) return 0;
  const total = cum[cum.length - 1] ?? 0;
  const d = Math.max(0, Math.min(along, total));
  let i = 0;
  while (i < cum.length - 1 && cum[i + 1] < d) i++;
  if (i >= coords.length - 1) i = coords.length - 2;
  const a = coords[i];
  const b = coords[i + 1];
  return bearingDegrees(a[0], a[1], b[0], b[1]);
}

/**
 * Advance an along-track cursor by deltaMeters and derive lon/lat/heading.
 * Cumulative-distance cursor — never restarts a segment from its start vertex.
 */
export function advanceAlongPath(
  coords: [number, number][],
  cum: number[],
  traveled: number,
  deltaMeters: number,
): PathPose {
  const total = cum[cum.length - 1] ?? 0;
  if (coords.length === 0 || total <= 0) {
    const c = coords[0] ?? [0, 0];
    return {
      lon: c[0],
      lat: c[1],
      heading: 0,
      traveled: 0,
      progress: 1,
      done: true,
    };
  }
  const next = Math.min(total, Math.max(0, traveled + deltaMeters));
  const pt = pointAtDistance(coords, cum, next) ?? coords[coords.length - 1];
  const heading = headingAtDistance(coords, cum, next);
  const done = next >= total - 1e-6;
  return {
    lon: pt[0],
    lat: pt[1],
    heading,
    traveled: next,
    progress: Math.min(1, next / total),
    done,
  };
}

/**
 * Headless RAF-style simulation: fixed dt ticks for `seconds` of simulated time.
 * Returns first/last pose and whether progress can advance while position is flat.
 */
export function headlessSimulate(
  coords: [number, number][],
  speedMps: number,
  seconds: number,
  fps = 60,
): {
  first: PathPose;
  last: PathPose;
  ticks: number;
  progressAdvancesWhilePosConstant: boolean;
  positionsDiffer: boolean;
} {
  const { cum, total } = buildCumDistances(coords);
  void total;
  const dt = 1 / fps;
  const maxTicks = Math.round(seconds / dt);
  let traveled = 0;
  const first = advanceAlongPath(coords, cum, 0, 0);
  let last = first;
  let progressAdvancesWhilePosConstant = false;
  let ticks = 0;

  for (let t = 0; t < maxTicks && !last.done; t++) {
    ticks++;
    const prev = last;
    last = advanceAlongPath(coords, cum, traveled, speedMps * dt);
    traveled = last.traveled;
    const posSame =
      Math.abs(last.lon - prev.lon) < 1e-9 &&
      Math.abs(last.lat - prev.lat) < 1e-9;
    if (posSame && last.progress > prev.progress + 1e-12 && !last.done) {
      progressAdvancesWhilePosConstant = true;
    }
  }

  return {
    first,
    last,
    ticks,
    progressAdvancesWhilePosConstant,
    positionsDiffer:
      Math.abs(last.lat - first.lat) > 1e-9 ||
      Math.abs(last.lon - first.lon) > 1e-9,
  };
}
