// How far the gate device is from its plant's fence, measured on the device (M4 spec §7 rule 3).
// Only a guide for the screen ("needs its location"); the server measures every punch again with
// the same maths (backend/app/modules/org/geofence.py): a flat projection around the plant,
// accurate to well under a metre over a few kilometres.

export type GateFence = {
  version_id: string;
  shape: "polygon" | "circle";
  /** GeoJSON (longitude, latitude): a Polygon, or the Point at a circle's centre. */
  geojson: { type: string; coordinates: unknown };
  radius_m: number | null;
  /** The margin around the drawn shape. */
  buffer_m: number;
};

const EARTH_RADIUS_M = 6_371_008.8;
const METRES_PER_DEGREE = (EARTH_RADIUS_M * Math.PI) / 180;

type Point = { x: number; y: number };

/** Turns lon/lat into metres around a reference point (lon0, lat0). */
export function projector(lon0: number, lat0: number) {
  const cosLat0 = Math.cos((lat0 * Math.PI) / 180);
  return (lon: number, lat: number): Point => ({
    x: (lon - lon0) * cosLat0 * METRES_PER_DEGREE,
    y: (lat - lat0) * METRES_PER_DEGREE,
  });
}

/** The ring of a polygon fence as [lon, lat] pairs. */
export function fenceRing(fence: GateFence): [number, number][] {
  const rings = fence.geojson.coordinates as [number, number][][];
  return rings[0] ?? [];
}

/** The fence's centre as [lon, lat]: a circle's centre or the average corner of a polygon. */
export function fenceCentre(fence: GateFence): [number, number] {
  if (fence.shape === "circle") return fence.geojson.coordinates as [number, number];
  const ring = fenceRing(fence);
  const lon = ring.reduce((sum, point) => sum + point[0], 0) / ring.length;
  const lat = ring.reduce((sum, point) => sum + point[1], 0) / ring.length;
  return [lon, lat];
}

/** Metres from the point to the drawn shape; 0 when the point is inside it. */
export function distanceToFenceM(fence: GateFence, lat: number, lon: number): number {
  const [lon0, lat0] = fenceCentre(fence);
  const toMetres = projector(lon0, lat0);
  const here = toMetres(lon, lat);
  if (fence.shape === "circle") {
    return Math.max(0, Math.hypot(here.x, here.y) - (fence.radius_m ?? 0));
  }
  const corners = fenceRing(fence).map(([cornerLon, cornerLat]) => toMetres(cornerLon, cornerLat));
  if (isInside(here, corners)) return 0;
  let nearest = Number.POSITIVE_INFINITY;
  for (const [start, end] of edges(corners)) {
    nearest = Math.min(nearest, distanceToSegment(here, start, end));
  }
  return nearest;
}

// Ray casting: count how often a line to the right of the point crosses the polygon's edges.
function isInside(point: Point, corners: Point[]): boolean {
  let inside = false;
  for (const [a, b] of edges(corners)) {
    const crosses =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** Each side of the polygon as [start, end]; the last corner joins the first. */
function edges(corners: Point[]): [Point, Point][] {
  return corners.map((corner, index) => [corner, corners[(index + 1) % corners.length] ?? corner]);
}

function distanceToSegment(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const along =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared),
        );
  return Math.hypot(point.x - (start.x + along * dx), point.y - (start.y + along * dy));
}
