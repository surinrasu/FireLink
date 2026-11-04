export interface LocationResult {
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  /** south, north, west, east, in WGS84 */
  bounds?: [number, number, number, number];
}
export type LocationQuery =
  | { kind: "region"; regionCode: string }
  | { kind: "search"; regionCode?: string; query: string }
  | { kind: "reverse"; latitude: number; longitude: number };
