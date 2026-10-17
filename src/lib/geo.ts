import {
  booleanPointInPolygon,
  nearestPointOnLine,
  point,
  lineString,
  distance,
  bearing,
} from '@turf/turf';
import type {
  Feature,
  FeatureCollection,
  Polygon,
  MultiPolygon,
  LineString,
  MultiLineString,
  Position,
} from 'geojson';
import type { WatershedProps, StreamProps } from './types';

export type WatershedFeature = Feature<Polygon | MultiPolygon, WatershedProps>;
export type StreamFeature = Feature<LineString | MultiLineString, StreamProps>;

/** Demo-friendly approach radius (meters). Slightly loose so Pali corridor GNIS streams fire. */
export const STREAM_APPROACH_M = 280;
/** Heading lookahead for stream approach (meters). */
export const STREAM_LOOKAHEAD_M = 1200;
/** Extra heading samples between 0 and STREAM_LOOKAHEAD_M. */
export const STREAM_LOOKAHEAD_STEPS = [400, 800, 1200] as const;

function lineParts(geom: LineString | MultiLineString): Position[][] {
  return geom.type === 'LineString' ? [geom.coordinates] : geom.coordinates;
}

export function findWatershed(
  lon: number,
  lat: number,
  watersheds: FeatureCollection<Polygon | MultiPolygon, WatershedProps>,
): WatershedFeature | null {
  const pt = point([lon, lat]);
  for (const f of watersheds.features) {
    if (booleanPointInPolygon(pt, f)) return f as WatershedFeature;
  }
  return null;
}

/** Distance in meters from point to a stream geometry. */
export function distanceToStreamMeters(
  lon: number,
  lat: number,
  stream: StreamFeature,
): number {
  const pt = point([lon, lat]);
  let best = Number.POSITIVE_INFINITY;
  for (const coords of lineParts(stream.geometry)) {
    if (coords.length < 2) continue;
    const line = lineString(coords);
    const nearest = nearestPointOnLine(line, pt, { units: 'meters' });
    const d = nearest.properties?.dist ?? distance(pt, nearest, { units: 'meters' });
    if (d < best) best = d;
  }
  return best;
}

/** Nearest named stream within maxMeters, if any. */
export function nearestStreamWithin(
  lon: number,
  lat: number,
  streams: FeatureCollection<LineString | MultiLineString, StreamProps>,
  maxMeters: number,
): { feature: StreamFeature; meters: number } | null {
  let best: { feature: StreamFeature; meters: number } | null = null;
  for (const f of streams.features) {
    const meters = distanceToStreamMeters(lon, lat, f as StreamFeature);
    if (meters <= maxMeters && (!best || meters < best.meters)) {
      best = { feature: f as StreamFeature, meters };
    }
  }
  return best;
}

/** Lookahead distance along heading for “approaching” detection. */
export function lookaheadPoint(
  lon: number,
  lat: number,
  headingDeg: number,
  meters: number,
): [number, number] {
  const R = 6371000;
  const brng = (headingDeg * Math.PI) / 180;
  const φ1 = (lat * Math.PI) / 180;
  const λ1 = (lon * Math.PI) / 180;
  const δ = meters / R;
  const φ2 = Math.asin(
    Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(brng),
  );
  const λ2 =
    λ1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(δ) * Math.cos(φ1),
      Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2),
    );
  return [((λ2 * 180) / Math.PI + 540) % 360 - 180, (φ2 * 180) / Math.PI];
}

export function bearingDegrees(
  fromLon: number,
  fromLat: number,
  toLon: number,
  toLat: number,
): number {
  return bearing(point([fromLon, fromLat]), point([toLon, toLat]));
}

export function haversineMeters(
  aLon: number,
  aLat: number,
  bLon: number,
  bLat: number,
): number {
  return distance(point([aLon, aLat]), point([bLon, bLat]), { units: 'meters' });
}

/**
 * Smart poll interval (ms): faster when within ~1 km of any stream or near a watershed edge.
 */
export function smartPollMs(
  lon: number,
  lat: number,
  heading: number,
  streams: FeatureCollection<LineString | MultiLineString, StreamProps>,
  nearWatershedBoundary: boolean,
): number {
  const [lx, ly] = lookaheadPoint(lon, lat, heading, 1000);
  const nearNow = nearestStreamWithin(lon, lat, streams, 1000);
  const nearAhead = nearestStreamWithin(lx, ly, streams, 1000);
  if (nearWatershedBoundary || nearNow || nearAhead) return 800;
  return 2500;
}

/** Cumulative distances along a coordinate ring (meters). */
export function cumulativeDistances(coords: [number, number][]): {
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

/** Interpolate [lon,lat] at distance along a path with precomputed cum distances. */
export function pointAtDistance(
  coords: [number, number][],
  cum: number[],
  distM: number,
): [number, number] | null {
  if (coords.length === 0) return null;
  if (distM <= 0) return coords[0];
  const total = cum[cum.length - 1] ?? 0;
  if (distM >= total) return coords[coords.length - 1];
  let i = 0;
  while (i < cum.length - 1 && cum[i + 1] < distM) i++;
  const seg = cum[i + 1] - cum[i];
  const t = seg > 1e-6 ? (distM - cum[i]) / seg : 0;
  const a = coords[i];
  const b = coords[i + 1];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Nearest distance along path to current lon/lat (snap). */
export function snapToRoute(
  lon: number,
  lat: number,
  coords: [number, number][],
  cum: number[],
): number {
  let bestD = Number.POSITIVE_INFINITY;
  let bestAlong = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i];
    const b = coords[i + 1];
    const segLen = cum[i + 1] - cum[i];
    if (segLen < 1e-6) continue;
    // Project onto segment in lon/lat (good enough at Oʻahu scale for demo)
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((lon - a[0]) * dx + (lat - a[1]) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const px = a[0] + dx * t;
    const py = a[1] + dy * t;
    const d = haversineMeters(lon, lat, px, py);
    if (d < bestD) {
      bestD = d;
      bestAlong = cum[i] + segLen * t;
    }
  }
  return bestAlong;
}

export interface UpcomingInfo {
  nextWatershed: { name: string; meters: number } | null;
  nextStream: { name: string; meters: number } | null;
}

/**
 * Best stream hit at current position or along multi-step heading lookahead.
 */
export function findStreamApproach(
  lon: number,
  lat: number,
  heading: number,
  streams: FeatureCollection<LineString | MultiLineString, StreamProps>,
  approachM: number = STREAM_APPROACH_M,
  lookSteps: readonly number[] = STREAM_LOOKAHEAD_STEPS,
): { feature: StreamFeature; meters: number } | null {
  const nearNow = nearestStreamWithin(lon, lat, streams, approachM);
  if (nearNow) return nearNow;
  let best: { feature: StreamFeature; meters: number } | null = null;
  for (const look of lookSteps) {
    const [lx, ly] = lookaheadPoint(lon, lat, heading, look);
    const hit = nearestStreamWithin(lx, ly, streams, approachM);
    if (hit && (!best || hit.meters < best.meters)) best = hit;
  }
  return best;
}
