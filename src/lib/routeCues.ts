import type { FeatureCollection, Polygon, MultiPolygon, LineString, MultiLineString } from 'geojson';
import {
  findWatershed,
  nearestStreamWithin,
  cumulativeDistances,
  pointAtDistance,
  STREAM_APPROACH_M,
} from './geo';
import type { WatershedProps, StreamProps } from './types';

export interface RouteCue {
  /** Distance along route from start (meters). */
  distM: number;
  kind: 'watershed-enter' | 'stream-approach';
  name: string;
}

/**
 * Precompute watershed enters and first-approach stream cues along a route.
 * Real GIS only — no invented hydrology.
 */
export function buildRouteCues(
  coords: [number, number][],
  watersheds: FeatureCollection<Polygon | MultiPolygon, WatershedProps>,
  streams: FeatureCollection<LineString | MultiLineString, StreamProps>,
  approachM: number = STREAM_APPROACH_M,
): RouteCue[] {
  if (coords.length < 2) return [];
  const { cum, total } = cumulativeDistances(coords);
  const cues: RouteCue[] = [];
  const seenStreams = new Set<string>();
  let lastWsId: string | null = null;
  const step = 30;

  for (let d = 0; d <= total; d += step) {
    const pt = pointAtDistance(coords, cum, d);
    if (!pt) break;
    const ws = findWatershed(pt[0], pt[1], watersheds);
    const wsId = ws?.properties.id ?? null;
    if (wsId !== lastWsId) {
      if (ws) {
        cues.push({
          distM: Math.round(d),
          kind: 'watershed-enter',
          name: ws.properties.name,
        });
      }
      lastWsId = wsId;
    }
    {
      const hit = nearestStreamWithin(pt[0], pt[1], streams, approachM);
      if (hit) {
        const name = hit.feature.properties.name;
        if (!seenStreams.has(name)) {
          seenStreams.add(name);
          cues.push({
            distM: Math.round(d),
            kind: 'stream-approach',
            name,
          });
        }
      }
    }
  }
  return cues.sort((a, b) => a.distM - b.distM);
}

export function upcomingFromCues(
  alongM: number,
  cues: RouteCue[],
): {
  nextWatershed: { name: string; meters: number } | null;
  nextStream: { name: string; meters: number } | null;
} {
  let nextWatershed: { name: string; meters: number } | null = null;
  let nextStream: { name: string; meters: number } | null = null;
  for (const c of cues) {
    const ahead = c.distM - alongM;
    // Watershed: only future boundary crosses (already-entered current poly is noise)
    if (c.kind === 'watershed-enter' && !nextWatershed && ahead > 80) {
      nextWatershed = { name: c.name, meters: Math.round(ahead) };
    }
    // Stream: include "now" (0 m) through future approaches
    if (c.kind === 'stream-approach' && !nextStream && ahead > -40) {
      nextStream = { name: c.name, meters: Math.max(0, Math.round(ahead)) };
    }
    if (nextWatershed && nextStream) break;
  }
  return { nextWatershed, nextStream };
}
