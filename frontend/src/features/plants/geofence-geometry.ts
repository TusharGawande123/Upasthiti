// Small geometry helpers for the geofence editor. They only help the admin while drawing
// (area, self-crossing, margin outline). The server checks every shape again and decides.
import area from "@turf/area";
import buffer from "@turf/buffer";
import circle from "@turf/circle";
import kinks from "@turf/kinks";
import type { GeofenceShape } from "./use-plants";

// The same limits as the server (backend/app/modules/org/geofence.py).
export const MIN_AREA_M2 = 100;
export const MAX_AREA_M2 = 2_000_000;
export const MIN_RADIUS_M = 20;
export const MAX_RADIUS_M = 1_000;
export const MIN_MARGIN_M = 0;
export const MAX_MARGIN_M = 200;

/** The outer ring of a polygon as [lon, lat] points (empty if there is none). */
export function ringOf(polygon: GeoJSON.Polygon): GeoJSON.Position[] {
  return polygon.coordinates[0] ?? [];
}

// A shape the admin has drawn but not saved yet.
export type Draft = {
  shape: GeofenceShape;
  geojson: GeoJSON.Polygon | GeoJSON.Point;
  radius_m?: number;
};

export type DraftProblem = "too_small" | "too_large" | "crosses_itself" | "radius_range";

export type DraftAnalysis = {
  areaM2: number;
  corners: number | null; // null for a circle
  problem: DraftProblem | null;
  crossing: [number, number] | null; // [lon, lat] of the first self-crossing
};

export function analyseDraft(draft: Draft): DraftAnalysis {
  if (draft.shape === "circle") {
    const radius = draft.radius_m ?? 0;
    const problem: DraftProblem | null =
      radius < MIN_RADIUS_M || radius > MAX_RADIUS_M ? "radius_range" : null;
    return { areaM2: Math.PI * radius * radius, corners: null, problem, crossing: null };
  }

  const polygon = draft.geojson as GeoJSON.Polygon;
  const areaM2 = area(polygon);
  // The ring repeats its first point at the end, so one fewer corner than points.
  const corners = Math.max(ringOf(polygon).length - 1, 0);
  const crossings = kinks(polygon).features;
  const crossing = (crossings[0]?.geometry.coordinates as [number, number] | undefined) ?? null;

  let problem: DraftProblem | null = null;
  if (crossing) problem = "crosses_itself";
  else if (areaM2 < MIN_AREA_M2) problem = "too_small";
  else if (areaM2 > MAX_AREA_M2) problem = "too_large";
  return { areaM2, corners, problem, crossing };
}

/** The dashed line `marginM` metres outside the shape, or null when the margin is zero. */
export function marginOutline(draft: Draft, marginM: number): GeoJSON.Feature | null {
  if (marginM <= 0) return null;
  if (draft.shape === "circle") {
    const centre = (draft.geojson as GeoJSON.Point).coordinates;
    return circle(centre, ((draft.radius_m ?? 0) + marginM) / 1000, { units: "kilometers" });
  }
  const outline = buffer(draft.geojson as GeoJSON.Polygon, marginM, { units: "meters" });
  return outline ?? null;
}

/** Centre point of the current shape, used to move the map there. */
export function draftCentre(draft: Draft): [number, number] {
  if (draft.shape === "circle")
    return (draft.geojson as GeoJSON.Point).coordinates as [number, number];
  const ring = ringOf(draft.geojson as GeoJSON.Polygon);
  const lons = ring.map((point) => point[0] ?? 0);
  const lats = ring.map((point) => point[1] ?? 0);
  return [(Math.min(...lons) + Math.max(...lons)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2];
}
