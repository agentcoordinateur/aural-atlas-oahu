import { useCallback, useEffect, useRef, useState } from 'react';
import type { FeatureCollection, LineString } from 'geojson';
import type { PositionState } from '../lib/types';
import {
  advanceAlongPath,
  buildCumDistances,
} from '../lib/simulatePath';

const IDLE: PositionState = {
  lon: -157.858,
  lat: 21.306,
  heading: 20,
  speedMps: 0,
  source: 'idle',
};

/** Demo ground speed so ~9 km route takes ~90–110 s at 1× (readable crawl). */
export const DEMO_SPEED_MPS = 90;

interface Options {
  /** Target ground speed for simulation (m/s). Use DEMO_SPEED_MPS for ~100 s runs. */
  speedMps?: number;
}

export function useSimulateDrive(options: Options = {}) {
  const speedMps = options.speedMps ?? DEMO_SPEED_MPS;
  const speedRef = useRef(speedMps);
  speedRef.current = speedMps;

  const [position, setPosition] = useState<PositionState>(IDLE);
  const [simulating, setSimulating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [finished, setFinished] = useState(false);
  const routeRef = useRef<[number, number][] | null>(null);
  const cumDistRef = useRef<number[] | null>(null);
  const totalDistRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);
  /** Along-track meters from route start — sole source of truth for pose. */
  const traveledRef = useRef(0);

  const loadRoute = useCallback(async () => {
    if (routeRef.current && cumDistRef.current) return routeRef.current;
    const res = await fetch(import.meta.env.BASE_URL + 'data/demo-route.geojson');
    const fc = (await res.json()) as FeatureCollection<LineString>;
    const coords = fc.features[0]?.geometry.coordinates as [number, number][];
    const { cum, total } = buildCumDistances(coords);
    routeRef.current = coords;
    cumDistRef.current = cum;
    totalDistRef.current = total;
    return coords;
  }, []);

  const stop = useCallback(() => {
    setSimulating(false);
    setFinished(false);
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    lastTsRef.current = null;
    setPosition((p) => ({ ...p, speedMps: 0, source: 'idle' }));
  }, []);

  const start = useCallback(async () => {
    const coords = await loadRoute();
    traveledRef.current = 0;
    lastTsRef.current = null;
    setProgress(0);
    setFinished(false);
    setSimulating(true);
    const cum = cumDistRef.current!;
    const pose = advanceAlongPath(coords, cum, 0, 0);
    setPosition({
      lon: pose.lon,
      lat: pose.lat,
      heading: pose.heading,
      speedMps: speedRef.current,
      source: 'simulate',
    });
  }, [loadRoute]);

  useEffect(() => {
    if (!simulating || !routeRef.current || !cumDistRef.current) return;
    const coords = routeRef.current;
    const cum = cumDistRef.current;

    const frame = (ts: number) => {
      // First RAF often has dt≈0 — must NOT treat as finished
      if (lastTsRef.current == null) {
        lastTsRef.current = ts;
        rafRef.current = requestAnimationFrame(frame);
        return;
      }
      const dt = Math.min(0.1, (ts - lastTsRef.current) / 1000);
      lastTsRef.current = ts;

      if (dt <= 0) {
        rafRef.current = requestAnimationFrame(frame);
        return;
      }

      const pose = advanceAlongPath(
        coords,
        cum,
        traveledRef.current,
        speedRef.current * dt,
      );
      traveledRef.current = pose.traveled;
      setProgress(pose.progress);
      setPosition({
        lon: pose.lon,
        lat: pose.lat,
        heading: pose.heading,
        speedMps: pose.done ? 0 : speedRef.current,
        source: 'simulate',
      });

      if (pose.done) {
        setProgress(1);
        setFinished(true);
        setSimulating(false);
        rafRef.current = null;
        return;
      }

      rafRef.current = requestAnimationFrame(frame);
    };

    rafRef.current = requestAnimationFrame(frame);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [simulating]);

  const toggle = useCallback(async () => {
    if (simulating) stop();
    else await start();
  }, [simulating, start, stop]);

  return {
    position,
    setPosition,
    simulating,
    progress,
    finished,
    start,
    stop,
    toggle,
    idle: IDLE,
  };
}
