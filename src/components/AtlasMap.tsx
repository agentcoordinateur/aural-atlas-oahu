import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  MapContainer,
  TileLayer,
  GeoJSON,
  CircleMarker,
  Polyline,
  useMap,
} from 'react-leaflet';
import type { FeatureCollection, Polygon, MultiPolygon, LineString, MultiLineString } from 'geojson';
import L from 'leaflet';
import type { PositionState, StreamProps, WatershedProps } from '../lib/types';
import type { WatershedFeature } from '../lib/geo';
import 'leaflet/dist/leaflet.css';

/** Soft-pan only when marker enters this fraction of the view from each edge. */
const EDGE_BUFFER = 0.18;

interface Props {
  watersheds: FeatureCollection<Polygon | MultiPolygon, WatershedProps> | null;
  streams: FeatureCollection<LineString | MultiLineString, StreamProps> | null;
  route: FeatureCollection<LineString> | null;
  activeWatershed: WatershedFeature | null;
  position: PositionState;
  simulating?: boolean;
}

/** On Simulate start: fit the whole demo route so the orange path is visible. */
function FitRouteOnSimulate({
  routeCoords,
  simulating,
}: {
  routeCoords: [number, number][] | null;
  simulating: boolean;
}) {
  const map = useMap();
  const wasSimulating = useRef(false);
  useEffect(() => {
    if (simulating && !wasSimulating.current && routeCoords && routeCoords.length >= 2) {
      const bounds = L.latLngBounds(routeCoords);
      map.fitBounds(bounds, {
        padding: [48, 48],
        maxZoom: 13.5,
        animate: true,
        duration: 0.6,
      });
    }
    wasSimulating.current = simulating;
  }, [simulating, routeCoords, map]);
  return null;
}

/**
 * Follow behavior:
 * - Simulate: do NOT pan every frame (that glued the red dot to screen center).
 *   Only soft-pan when the marker approaches the map edge (~18% buffer).
 * - GPS / live: keep centering via panTo.
 */
function FollowUser({
  position,
  simulating,
}: {
  position: PositionState;
  simulating: boolean;
}) {
  const map = useMap();
  useEffect(() => {
    if (position.source === 'idle') return;

    const isSim = position.source === 'simulate' || simulating;
    if (isSim) {
      const bounds = map.getBounds();
      const sw = bounds.getSouthWest();
      const ne = bounds.getNorthEast();
      const latSpan = ne.lat - sw.lat;
      const lngSpan = ne.lng - sw.lng;
      if (latSpan <= 0 || lngSpan <= 0) return;

      const latMin = sw.lat + latSpan * EDGE_BUFFER;
      const latMax = ne.lat - latSpan * EDGE_BUFFER;
      const lngMin = sw.lng + lngSpan * EDGE_BUFFER;
      const lngMax = ne.lng - lngSpan * EDGE_BUFFER;

      const { lat, lon } = position;
      const nearEdge =
        lat < latMin || lat > latMax || lon < lngMin || lon > lngMax;
      if (nearEdge) {
        map.panTo([lat, lon], {
          animate: true,
          duration: 0.55,
          easeLinearity: 0.3,
        });
      }
      return;
    }

    map.panTo([position.lat, position.lon], { animate: true, duration: 0.4 });
  }, [map, position.lat, position.lon, position.source, simulating]);
  return null;
}

/**
 * Imperative CircleMarker: setLatLng every pose change so Leaflet always
 * moves the SVG path even when React prop diffs are subtle / remounts flake.
 */
function ImperativeUserMarker({
  position,
  moving,
}: {
  position: PositionState;
  moving: boolean;
}) {
  const markerRef = useRef<L.CircleMarker | null>(null);
  const pulseRef = useRef<L.CircleMarker | null>(null);
  const headingRef = useRef<L.Polyline | null>(null);

  const headingTip = useMemo(() => {
    const R = 6371000;
    const m = 80;
    const brng = (position.heading * Math.PI) / 180;
    const φ1 = (position.lat * Math.PI) / 180;
    const λ1 = (position.lon * Math.PI) / 180;
    const δ = m / R;
    const φ2 = Math.asin(
      Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(brng),
    );
    const λ2 =
      λ1 +
      Math.atan2(
        Math.sin(brng) * Math.sin(δ) * Math.cos(φ1),
        Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2),
      );
    return [
      (φ2 * 180) / Math.PI,
      ((λ2 * 180) / Math.PI + 540) % 360 - 180,
    ] as [number, number];
  }, [position.lon, position.lat, position.heading]);

  useLayoutEffect(() => {
    const ll = L.latLng(position.lat, position.lon);
    markerRef.current?.setLatLng(ll);
    pulseRef.current?.setLatLng(ll);
    headingRef.current?.setLatLngs([ll, L.latLng(headingTip[0], headingTip[1])]);
  }, [position.lat, position.lon, headingTip]);

  return (
    <>
      {moving && (
        <CircleMarker
          ref={pulseRef}
          center={[position.lat, position.lon]}
          radius={22}
          pathOptions={{
            color: '#e53935',
            weight: 2,
            opacity: 0.45,
            fillColor: '#e53935',
            fillOpacity: 0.15,
            className: 'user-marker-pulse',
          }}
        />
      )}
      <CircleMarker
        ref={markerRef}
        center={[position.lat, position.lon]}
        radius={moving ? 14 : 9}
        pathOptions={{
          color: '#fff',
          weight: 3,
          fillColor: '#e53935',
          fillOpacity: 1,
        }}
      />
      <Polyline
        ref={headingRef}
        positions={[
          [position.lat, position.lon],
          headingTip,
        ]}
        pathOptions={{ color: '#e53935', weight: 3, opacity: 0.9 }}
      />
    </>
  );
}

export function AtlasMap({
  watersheds,
  streams,
  route,
  activeWatershed,
  position,
  simulating = false,
}: Props) {
  const activeId = activeWatershed?.properties.id ?? null;
  const moving = position.source === 'simulate' || simulating;

  const [trail, setTrail] = useState<[number, number][]>([]);

  useLayoutEffect(() => {
    if (position.source === 'idle') {
      setTrail([]);
      return;
    }
    setTrail((prev) => {
      const next: [number, number] = [position.lat, position.lon];
      const last = prev[prev.length - 1];
      if (
        last &&
        Math.abs(last[0] - next[0]) < 1e-7 &&
        Math.abs(last[1] - next[1]) < 1e-7
      ) {
        return prev;
      }
      // Grow for the whole simulate run (no short cap) so motion is obvious
      return [...prev, next];
    });
  }, [position.lat, position.lon, position.source]);

  // Reset trail when a new simulate run starts
  const prevSource = useRef(position.source);
  useEffect(() => {
    if (prevSource.current === 'idle' && position.source === 'simulate') {
      setTrail([[position.lat, position.lon]]);
    }
    prevSource.current = position.source;
  }, [position.source, position.lat, position.lon]);

  const watershedStyle = useMemo(() => {
    return (feature?: GeoJSON.Feature) => {
      const id = (feature?.properties as WatershedProps | undefined)?.id;
      const active = id != null && id === activeId;
      return {
        color: active ? '#f5d76e' : '#2a6f5f',
        weight: active ? 3 : 1,
        opacity: active ? 1 : 0.45,
        fillColor: active ? '#f5d76e' : '#1a4d40',
        fillOpacity: active ? 0.45 : 0.12,
      };
    };
  }, [activeId]);

  const streamStyle = useMemo(
    () => ({
      color: '#4fc3f7',
      weight: 2,
      opacity: 0.85,
    }),
    [],
  );

  const routeCoords = useMemo(() => {
    if (!route?.features[0]) return null;
    return route.features[0].geometry.coordinates.map(
      (c) => [c[1], c[0]] as [number, number],
    );
  }, [route]);

  return (
    <MapContainer
      center={[21.35, -157.82]}
      zoom={12}
      className="atlas-map"
      zoomControl={false}
      attributionControl={true}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {watersheds && (
        <GeoJSON
          key={`ws-${activeId ?? 'none'}-${watersheds.features.length}`}
          data={watersheds as GeoJSON.GeoJsonObject}
          style={watershedStyle as L.StyleFunction}
          onEachFeature={(feature, layer) => {
            const name = (feature.properties as WatershedProps)?.name;
            if (name) layer.bindTooltip(name, { sticky: true });
          }}
        />
      )}
      {streams && (
        <GeoJSON
          data={streams as GeoJSON.GeoJsonObject}
          style={streamStyle}
          onEachFeature={(feature, layer) => {
            const name = (feature.properties as StreamProps)?.name;
            if (name) layer.bindTooltip(name, { sticky: true });
          }}
        />
      )}
      {routeCoords && (
        <Polyline
          positions={routeCoords}
          pathOptions={{ color: '#ff8a65', weight: 3, opacity: 0.7, dashArray: '6 8' }}
        />
      )}
      {/* Growing trail — motion obvious while basemap stays put */}
      {trail.length >= 2 && (
        <Polyline
          positions={trail}
          pathOptions={{
            color: '#e53935',
            weight: 4,
            opacity: 0.55,
            lineCap: 'round',
            lineJoin: 'round',
          }}
        />
      )}
      <ImperativeUserMarker position={position} moving={moving} />
      <FitRouteOnSimulate routeCoords={routeCoords} simulating={simulating} />
      <FollowUser position={position} simulating={simulating} />
    </MapContainer>
  );
}
