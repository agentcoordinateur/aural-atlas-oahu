import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { bearingDegrees } from '../lib/geo';
import type { PositionState } from '../lib/types';

/** Optional real GPS — only active when not simulating. */
export function useGps(
  enabled: boolean,
  setPosition: Dispatch<SetStateAction<PositionState>>,
) {
  const lastRef = useRef<{ lon: number; lat: number } | null>(null);

  const onPos = useCallback(
    (pos: GeolocationPosition) => {
      const lon = pos.coords.longitude;
      const lat = pos.coords.latitude;
      // Demo is Oʻahu-first — ignore bogus IP/VPN GPS far from the island
      const onOahu =
        lon >= -158.35 && lon <= -157.55 && lat >= 21.2 && lat <= 21.75;
      if (!onOahu) return;
      let heading = pos.coords.heading ?? 0;
      if ((heading == null || Number.isNaN(heading)) && lastRef.current) {
        heading = bearingDegrees(lastRef.current.lon, lastRef.current.lat, lon, lat);
      }
      lastRef.current = { lon, lat };
      setPosition({
        lon,
        lat,
        heading: heading ?? 0,
        speedMps: pos.coords.speed ?? 0,
        source: 'gps',
      });
    },
    [setPosition],
  );

  useEffect(() => {
    if (!enabled || !navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(onPos, undefined, {
      enableHighAccuracy: true,
      maximumAge: 1000,
      timeout: 10000,
    });
    return () => navigator.geolocation.clearWatch(id);
  }, [enabled, onPos]);
}
