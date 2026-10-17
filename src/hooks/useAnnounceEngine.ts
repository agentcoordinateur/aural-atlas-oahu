import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FeatureCollection, Polygon, MultiPolygon, LineString, MultiLineString } from 'geojson';
import {
  findWatershed,
  lookaheadPoint,
  smartPollMs,
  haversineMeters,
  findStreamApproach,
  cumulativeDistances,
  pointAtDistance,
  snapToRoute,
  nearestStreamWithin,
  STREAM_APPROACH_M,
  type WatershedFeature,
  type UpcomingInfo,
} from '../lib/geo';
import { buildRouteCues, upcomingFromCues } from '../lib/routeCues';
import { announce } from '../lib/speech';
import type { AnnounceEvent, PositionState, StreamProps, WatershedProps } from '../lib/types';

/** Shorter cooldown so the demo route can announce several streams without long silence. */
const STREAM_COOLDOWN_MS = 45_000;
const BOUNDARY_NEAR_M = 350;
const MOVE_TICK_M = 20;
const ROUTE_LOOKAHEAD_STEPS = [300, 600, 900, 1200] as const;

interface Args {
  watersheds: FeatureCollection<Polygon | MultiPolygon, WatershedProps> | null;
  streams: FeatureCollection<LineString | MultiLineString, StreamProps> | null;
  /** Demo route coordinates for Upcoming + along-route stream assist. */
  routeCoords: [number, number][] | null;
  position: PositionState;
  blurbsEnabled: boolean;
}

export function useAnnounceEngine({
  watersheds,
  streams,
  routeCoords,
  position,
  blurbsEnabled,
}: Args) {
  const [activeWatershed, setActiveWatershed] = useState<WatershedFeature | null>(null);
  const [events, setEvents] = useState<AnnounceEvent[]>([]);
  const [lastStreamNear, setLastStreamNear] = useState<string | null>(null);
  const [upcoming, setUpcoming] = useState<UpcomingInfo>({
    nextWatershed: null,
    nextStream: null,
  });

  const activeIdRef = useRef<string | null>(null);
  const streamCooldownRef = useRef<Map<string, number>>(new Map());
  const lastTickPosRef = useRef<{ lon: number; lat: number } | null>(null);
  const positionRef = useRef(position);
  const blurbsRef = useRef(blurbsEnabled);
  const watershedsRef = useRef(watersheds);
  const streamsRef = useRef(streams);
  const routeRef = useRef(routeCoords);

  positionRef.current = position;
  blurbsRef.current = blurbsEnabled;
  watershedsRef.current = watersheds;
  streamsRef.current = streams;
  routeRef.current = routeCoords;

  const routeCues = useMemo(() => {
    if (!routeCoords || !watersheds || !streams) return [];
    return buildRouteCues(routeCoords, watersheds, streams, STREAM_APPROACH_M);
  }, [routeCoords, watersheds, streams]);

  const routeCum = useMemo(() => {
    if (!routeCoords || routeCoords.length < 2) return null;
    return cumulativeDistances(routeCoords);
  }, [routeCoords]);

  const cuesRef = useRef(routeCues);
  const cumRef = useRef(routeCum);
  cuesRef.current = routeCues;
  cumRef.current = routeCum;

  const pushEvent = useCallback((ev: Omit<AnnounceEvent, 'id' | 'at'>) => {
    const full: AnnounceEvent = {
      ...ev,
      id: `${ev.kind}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      at: Date.now(),
    };
    setEvents((prev) => [full, ...prev].slice(0, 40));
    return full;
  }, []);

  const refreshUpcoming = useCallback(() => {
    const route = routeRef.current;
    const cum = cumRef.current;
    const cues = cuesRef.current;
    const pos = positionRef.current;
    if (!route || !cum || cues.length === 0 || pos.source === 'idle') {
      setUpcoming({ nextWatershed: null, nextStream: null });
      return;
    }
    const along = snapToRoute(pos.lon, pos.lat, route, cum.cum);
    setUpcoming(upcomingFromCues(along, cues));
  }, []);

  const tick = useCallback(() => {
    const watershedsNow = watershedsRef.current;
    const streamsNow = streamsRef.current;
    const route = routeRef.current;
    const cum = cumRef.current;
    const pos = positionRef.current;
    if (!watershedsNow || !streamsNow) return;
    if (pos.source === 'idle') return;

    const { lon, lat, heading } = pos;
    const ws = findWatershed(lon, lat, watershedsNow);
    const wsId = ws?.properties.id ?? null;
    const prevId = activeIdRef.current;

    if (wsId !== prevId) {
      if (prevId) {
        const prev =
          watershedsNow.features.find((f) => f.properties.id === prevId) ?? null;
        const name = prev?.properties.name ?? 'previous watershed';
        const msg = `Leaving ${name} watershed.`;
        announce(msg);
        pushEvent({ kind: 'watershed-leave', title: msg });
      }
      if (ws) {
        const name = ws.properties.name;
        let msg = `Entering ${name} watershed.`;
        if (blurbsRef.current && ws.properties.area_sqmi != null) {
          msg += ` About ${ws.properties.area_sqmi} square miles.`;
        }
        announce(msg);
        pushEvent({
          kind: 'watershed-enter',
          title: `Entering ${name}`,
          detail:
            blurbsRef.current && ws.properties.area_sqmi != null
              ? `~${ws.properties.area_sqmi} sq mi`
              : undefined,
        });
      }
      activeIdRef.current = wsId;
      setActiveWatershed(ws);
    } else {
      setActiveWatershed(ws);
    }

    // Heading multi-step lookahead (loosened for demo corridor)
    let hit = findStreamApproach(lon, lat, heading, streamsNow);

    // Along-route assist: sample ahead on the canned path (winding Pali headings
    // can miss side streams that the road actually approaches).
    if (!hit && route && cum) {
      const along = snapToRoute(lon, lat, route, cum.cum);
      for (const look of ROUTE_LOOKAHEAD_STEPS) {
        const pt = pointAtDistance(route, cum.cum, along + look);
        if (!pt) break;
        const near = nearestStreamWithin(
          pt[0],
          pt[1],
          streamsNow,
          STREAM_APPROACH_M,
        );
        if (near) {
          hit = near;
          break;
        }
      }
    }

    const now = Date.now();

    if (hit) {
      const name = hit.feature.properties.name;
      const last = streamCooldownRef.current.get(name) ?? 0;
      if (now - last > STREAM_COOLDOWN_MS) {
        streamCooldownRef.current.set(name, now);
        const meters = Math.round(hit.meters);
        const msg =
          meters < 40
            ? `Crossing ${name}.`
            : `Approaching ${name}, about ${meters} meters.`;
        announce(msg);
        pushEvent({
          kind: 'stream-approach',
          title: msg,
          detail: hit.feature.properties.length_km
            ? `Mapped length ~${hit.feature.properties.length_km} km`
            : undefined,
        });
        setLastStreamNear(name);
      }
    }

    lastTickPosRef.current = { lon, lat };
    refreshUpcoming();
  }, [pushEvent, refreshUpcoming]);

  // Tick when the vehicle moves meaningfully
  useEffect(() => {
    if (position.source === 'idle') return;
    const last = lastTickPosRef.current;
    if (
      !last ||
      haversineMeters(last.lon, last.lat, position.lon, position.lat) >= MOVE_TICK_M
    ) {
      tick();
    }
  }, [position.lon, position.lat, position.source, tick]);

  // Smart background poll (catch slow GPS / boundary lookahead)
  useEffect(() => {
    if (!watersheds || !streams || position.source === 'idle') return;

    let cancelled = false;
    let timer: number | undefined;

    const schedule = () => {
      const pos = positionRef.current;
      const nearBoundary = (() => {
        if (!activeIdRef.current) return true;
        const [lx, ly] = lookaheadPoint(
          pos.lon,
          pos.lat,
          pos.heading,
          BOUNDARY_NEAR_M,
        );
        const ahead = findWatershed(lx, ly, watersheds);
        return (ahead?.properties.id ?? null) !== activeIdRef.current;
      })();

      const ms = smartPollMs(
        pos.lon,
        pos.lat,
        pos.heading,
        streams,
        nearBoundary,
      );
      timer = window.setTimeout(() => {
        if (cancelled) return;
        tick();
        schedule();
      }, ms);
    };

    schedule();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [watersheds, streams, position.source, tick]);

  // Keep Upcoming fresh while moving
  useEffect(() => {
    if (position.source === 'idle') {
      setUpcoming({ nextWatershed: null, nextStream: null });
      return;
    }
    refreshUpcoming();
  }, [position.lon, position.lat, position.source, routeCues, refreshUpcoming]);

  const reset = useCallback(() => {
    activeIdRef.current = null;
    streamCooldownRef.current.clear();
    lastTickPosRef.current = null;
    setActiveWatershed(null);
    setLastStreamNear(null);
    setEvents([]);
    setUpcoming({ nextWatershed: null, nextStream: null });
  }, []);

  return { activeWatershed, events, lastStreamNear, upcoming, reset };
}
