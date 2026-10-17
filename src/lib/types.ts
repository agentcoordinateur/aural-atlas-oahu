export type LonLat = [number, number]; // [lon, lat]

export interface WatershedProps {
  name: string;
  id: string;
  area_sqmi: number | null;
  name_hwn?: string | null;
}

export interface StreamProps {
  name: string;
  length_km?: number;
}

export interface PositionState {
  lon: number;
  lat: number;
  heading: number; // degrees clockwise from north
  speedMps: number;
  source: 'gps' | 'simulate' | 'idle';
}

export interface AnnounceEvent {
  id: string;
  kind: 'watershed-enter' | 'watershed-leave' | 'stream-approach';
  title: string;
  detail?: string;
  at: number;
}
