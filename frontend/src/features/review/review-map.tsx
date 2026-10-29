// The map of one punch in the review panel (spec M4 §4.8): the fence version that was current at
// the punch time with its margin ring, the punch point with its accuracy circle, or both points of
// a travel / two-devices flag. Read only. Loaded lazily (Leaflet is big), so the review page
// opens at once; the facts are also written as text under the map, never the map alone (a11y).
// The drawing helpers come from the plants feature; the tiles are the same free OpenStreetMap
// and Esri World Imagery layers as the geofence map (decision 0014).
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { type Draft, draftCentre, marginOutline, ringOf } from "../plants/geofence-geometry";

export type MapPoint = { lat: number; lon: number; accuracy_m?: number | null; number?: 1 | 2 };

type Props = {
  fence: Draft | null;
  marginM: number;
  points: MapPoint[];
  label: string;
};

const SATELLITE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const LAYER_KEY = "upasthiti.map.layer"; // shared with the geofence map: one choice for both
const MIDC_WALUJ: L.LatLngTuple = [19.85, 75.2];

function savedLayerIsSatellite(): boolean {
  try {
    return localStorage.getItem(LAYER_KEY) === "satellite";
  } catch {
    return false;
  }
}

function fenceLayer(fence: Draft): L.Layer {
  const style: L.PathOptions = { color: "#1d3a8a", weight: 3, fillOpacity: 0.18 };
  if (fence.shape === "circle") {
    const [lon = 0, lat = 0] = (fence.geojson as GeoJSON.Point).coordinates;
    return L.circle([lat, lon], { ...style, radius: fence.radius_m ?? 0 });
  }
  const ring = ringOf(fence.geojson as GeoJSON.Polygon);
  return L.polygon(
    ring.slice(0, -1).map(([lon = 0, lat = 0]) => [lat, lon] as L.LatLngTuple),
    style,
  );
}

// Colour is never the only carrier: the fence is solid, the margin dashed, the point a dot with
// a number when there are two, the accuracy a dotted ring.
function pointLayers(point: MapPoint): L.Layer[] {
  const layers: L.Layer[] = [];
  const colour = point.number === 1 ? "#1d6bf3" : "#b91c1c";
  if (point.accuracy_m) {
    layers.push(
      L.circle([point.lat, point.lon], {
        radius: point.accuracy_m,
        color: colour,
        weight: 1.5,
        dashArray: "2 4",
        fillOpacity: 0.06,
        interactive: false,
      }),
    );
  }
  layers.push(
    point.number
      ? L.marker([point.lat, point.lon], {
          icon: L.divIcon({
            className: "",
            html: `<span style="display:grid;place-items:center;width:26px;height:26px;border-radius:50%;background:${colour};color:#fff;font:700 13px/1 Inter,sans-serif;border:2px solid #fff">${point.number}</span>`,
            iconSize: [26, 26],
            iconAnchor: [13, 13],
          }),
          interactive: false,
        })
      : L.circleMarker([point.lat, point.lon], {
          radius: 7,
          color: "#fff",
          weight: 3,
          fillColor: colour,
          fillOpacity: 1,
          interactive: false,
        }),
  );
  return layers;
}

export function ReviewMap({ fence, marginM, points, label }: Props) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [satellite, setSatellite] = useState(savedLayerIsSatellite);
  const [failed, setFailed] = useState(false);

  // Rebuilt whenever the punch, the fence or the map type changes (small map, cheap to redraw).
  // biome-ignore lint/correctness/useExhaustiveDependencies: `points` and `fence` are new objects on every render; their content is the dependency
  useEffect(() => {
    if (!containerRef.current) return;
    // A view must exist before shapes are added: Leaflet measures a circle with the map's
    // projection. Start at the fence (or the first point), then fit everything in.
    const first = points[0];
    const start: L.LatLngTuple = fence
      ? [draftCentre(fence)[1], draftCentre(fence)[0]]
      : first
        ? [first.lat, first.lon]
        : MIDC_WALUJ;
    const map = L.map(containerRef.current, { scrollWheelZoom: false }).setView(start, 17);
    try {
      if (satellite) {
        L.tileLayer(SATELLITE_URL, { maxZoom: 19, maxNativeZoom: 18 }).addTo(map);
      } else {
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
      }
      const group = L.featureGroup().addTo(map);
      if (fence) {
        fenceLayer(fence).addTo(group);
        const outline = marginOutline(fence, marginM);
        if (outline) {
          L.geoJSON(outline, {
            style: { color: "#8f5300", weight: 2, dashArray: "6 6", fill: false },
            interactive: false,
          }).addTo(group);
        }
      }
      for (const point of points) {
        for (const layer of pointLayers(point)) layer.addTo(group);
      }
      L.control.scale({ metric: true, imperial: false }).addTo(map);
      const bounds = group.getBounds();
      if (bounds.isValid()) map.fitBounds(bounds, { maxZoom: 18, padding: [30, 30] });
      setFailed(false);
    } catch {
      // The facts are also written under the map, so a map that cannot be drawn loses nothing.
      setFailed(true);
    }
    return () => {
      map.remove();
    };
  }, [satellite, marginM, JSON.stringify(fence), JSON.stringify(points)]);

  const choose = (wantSatellite: boolean) => {
    setSatellite(wantSatellite);
    try {
      localStorage.setItem(LAYER_KEY, wantSatellite ? "satellite" : "map");
    } catch {
      // Blocked storage: the choice lasts until the panel closes.
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          aria-pressed={!satellite}
          className={!satellite ? "border-primary ring-2 ring-primary/30" : ""}
          onClick={() => choose(false)}
        >
          {t("review.sheet.mapStreet")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          aria-pressed={satellite}
          className={satellite ? "border-primary ring-2 ring-primary/30" : ""}
          onClick={() => choose(true)}
        >
          {t("review.sheet.mapSatellite")}
        </Button>
      </div>
      <div
        ref={containerRef}
        role="img"
        aria-label={label}
        className="h-72 w-full overflow-hidden rounded-lg border"
      />
      {failed ? (
        <p className="text-xs font-semibold text-warning">{t("review.sheet.mapFailed")}</p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {satellite ? t("review.sheet.satelliteCredit") : t("review.sheet.streetCredit")}
      </p>
    </div>
  );
}
