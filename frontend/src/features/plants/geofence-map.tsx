// The map used to see and draw a plant's geofence: Leaflet + the free Leaflet-Geoman tools on
// OpenStreetMap tiles. It keeps at most ONE shape. Drawing or editing reports a `Draft`
// to the parent; the server validates the shape again when it is saved.
import "leaflet/dist/leaflet.css";
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css";
import L from "leaflet";
import "@geoman-io/leaflet-geoman-free";
import { useEffect, useRef } from "react";
import { type Draft, draftCentre, marginOutline, ringOf } from "./geofence-geometry";

// MIDC Waluj, Chhatrapati Sambhajinagar: where all of the client's plants are.
const DEFAULT_CENTRE: L.LatLngTuple = [19.85, 75.2];
const DEFAULT_ZOOM = 16;

type Props = {
  // The saved shape (or the version being previewed). null = none yet.
  saved: Draft | null;
  editable: boolean;
  marginM: number;
  onDraftChange?: (draft: Draft | null) => void;
  // Where to start when nothing is saved: the plant's own position, if known.
  startAt?: [number, number];
  label: string;
};

function layerToDraft(layer: L.Layer): Draft | null {
  if (layer instanceof L.Circle) {
    const centre = layer.getLatLng();
    return {
      shape: "circle",
      geojson: { type: "Point", coordinates: [centre.lng, centre.lat] },
      radius_m: Math.round(layer.getRadius()),
    };
  }
  if (layer instanceof L.Polygon) {
    const geometry = (layer as L.Polygon).toGeoJSON().geometry;
    if (geometry.type === "Polygon") return { shape: "polygon", geojson: geometry };
  }
  return null;
}

function draftToLayer(draft: Draft, style: L.PathOptions): L.Layer {
  if (draft.shape === "circle") {
    const [lon = 0, lat = 0] = (draft.geojson as GeoJSON.Point).coordinates;
    return L.circle([lat, lon], { ...style, radius: draft.radius_m ?? 0 });
  }
  const ring = ringOf(draft.geojson as GeoJSON.Polygon);
  return L.polygon(
    ring.slice(0, -1).map(([lon = 0, lat = 0]) => [lat, lon] as L.LatLngTuple),
    style,
  );
}

const SHAPE_STYLE: L.PathOptions = { color: "#1d3a8a", weight: 3, fillOpacity: 0.18 };
const MARGIN_STYLE: L.PathOptions = {
  color: "#1d3a8a",
  weight: 2,
  dashArray: "6 6",
  fill: false,
  interactive: false,
};

export function GeofenceMap({ saved, editable, marginM, onDraftChange, startAt, label }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const shapeRef = useRef<L.Layer | null>(null);
  const marginRef = useRef<L.GeoJSON | L.Layer | null>(null);
  const draftRef = useRef<Draft | null>(saved);
  // Always call the latest callback without rebuilding the map.
  const onChangeRef = useRef(onDraftChange);
  onChangeRef.current = onDraftChange;
  const marginValueRef = useRef(marginM);
  marginValueRef.current = marginM;

  function drawMargin() {
    const map = mapRef.current;
    if (!map) return;
    if (marginRef.current) {
      map.removeLayer(marginRef.current);
      marginRef.current = null;
    }
    const draft = draftRef.current;
    const outline = draft ? marginOutline(draft, marginValueRef.current) : null;
    if (outline) {
      marginRef.current = L.geoJSON(outline, { style: MARGIN_STYLE }).addTo(map);
    }
  }

  function setShape(draft: Draft | null, announce: boolean) {
    const map = mapRef.current;
    if (!map) return;
    if (shapeRef.current) {
      map.removeLayer(shapeRef.current);
      shapeRef.current = null;
    }
    draftRef.current = draft;
    if (draft) {
      const layer = draftToLayer(draft, SHAPE_STYLE).addTo(map);
      shapeRef.current = layer;
      if (editable) wireEditing(layer);
    }
    drawMargin();
    if (announce) onChangeRef.current?.(draft);
  }

  // After the shape is edited with the Geoman handles, report the new shape.
  function wireEditing(layer: L.Layer) {
    layer.on("pm:edit", () => {
      draftRef.current = layerToDraft(layer);
      drawMargin();
      onChangeRef.current?.(draftRef.current);
    });
    layer.on("pm:remove", () => {
      shapeRef.current = null;
      draftRef.current = null;
      drawMargin();
      onChangeRef.current?.(null);
    });
  }

  // Build the map once.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the map is built once; later changes are handled by the effects below
  useEffect(() => {
    if (!containerRef.current) return;
    const map = L.map(containerRef.current, { scrollWheelZoom: true }).setView(
      startAt ? [startAt[1], startAt[0]] : DEFAULT_CENTRE,
      DEFAULT_ZOOM,
    );
    mapRef.current = map;
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    L.control.scale({ metric: true, imperial: false }).addTo(map);

    if (editable) {
      map.pm.addControls({
        position: "topleft",
        drawMarker: false,
        drawCircleMarker: false,
        drawPolyline: false,
        drawRectangle: false,
        drawText: false,
        cutPolygon: false,
        rotateMode: false,
        dragMode: false,
        drawCircle: true,
        drawPolygon: true,
        editMode: true,
        removalMode: true,
      });
      map.pm.setLang("en");
      // A new drawing replaces the old shape: there is only ever one geofence shape.
      map.on("pm:create", (event) => {
        const layer = (event as unknown as { layer: L.Layer }).layer;
        map.removeLayer(layer);
        setShape(layerToDraft(layer), true);
      });
    }

    setShape(saved, false);
    if (saved) {
      const [lon, lat] = draftCentre(saved);
      map.setView([lat, lon], DEFAULT_ZOOM);
      if (shapeRef.current && "getBounds" in shapeRef.current) {
        map.fitBounds((shapeRef.current as L.Polygon).getBounds(), {
          maxZoom: 18,
          padding: [30, 30],
        });
      }
    }
    return () => {
      map.remove();
      mapRef.current = null;
      shapeRef.current = null;
      marginRef.current = null;
    };
  }, []);

  // Show another saved shape (for example when the admin previews an older version).
  // biome-ignore lint/correctness/useExhaustiveDependencies: setShape only uses refs
  useEffect(() => {
    if (!mapRef.current) return;
    setShape(saved, false);
    if (saved && shapeRef.current && "getBounds" in shapeRef.current) {
      mapRef.current.fitBounds((shapeRef.current as L.Polygon).getBounds(), {
        maxZoom: 18,
        padding: [30, 30],
      });
    }
  }, [saved]);

  // Redraw the dashed margin line when the margin number changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: drawMargin only uses refs
  useEffect(() => {
    drawMargin();
  }, [marginM]);

  return (
    <div
      ref={containerRef}
      role="application"
      aria-label={label}
      className="h-[460px] w-full overflow-hidden rounded-lg border"
    />
  );
}
