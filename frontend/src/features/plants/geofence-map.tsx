// The map used to see and draw a plant's geofence: Leaflet + the free Leaflet-Geoman tools on
// OpenStreetMap tiles, with a satellite view and a "Show my location" button (the admin often
// stands at the gate while drawing). It keeps at most ONE shape. Drawing or editing reports a
// `Draft` to the parent; the server validates the shape again when it is saved.
import "leaflet/dist/leaflet.css";
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css";
import L from "leaflet";
import "@geoman-io/leaflet-geoman-free";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
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

// The satellite pictures come from Esri's public World Imagery service (free to view with the
// credit shown on the map). Where it has no sharper picture, the last one is stretched.
const SATELLITE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const SATELLITE_CREDIT =
  "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics and the GIS User Community";
const LAYER_KEY = "upasthiti.map.layer";

function savedLayerIsSatellite(): boolean {
  try {
    return localStorage.getItem(LAYER_KEY) === "satellite";
  } catch {
    return false;
  }
}

function saveLayerChoice(satellite: boolean): void {
  try {
    localStorage.setItem(LAYER_KEY, satellite ? "satellite" : "map");
  } catch {
    // Blocked storage: the choice lasts until the page is reloaded.
  }
}

type LocateTexts = {
  show: string;
  stop: string;
  finding: string;
  failed: string;
  here: (metres: number) => string;
};

const LOCATE_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="2" x2="5" y1="12" y2="12"/><line x1="19" x2="22" y1="12" y2="12"/><line x1="12" x2="12" y1="2" y2="5"/><line x1="12" x2="12" y1="19" y2="22"/><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>';

/**
 * A "Show my location" button. One click finds where this device is, shows a blue dot with a
 * circle for the accuracy and moves the map there; the dot follows while the person walks. A
 * second click stops it. Browsers give the location only on https and after the person allows it.
 */
function addLocateControl(map: L.Map, texts: LocateTexts): void {
  const dot = L.circleMarker([0, 0], {
    radius: 8,
    color: "#ffffff",
    weight: 3,
    fillColor: "#1d6bf3",
    fillOpacity: 1,
  });
  const accuracy = L.circle([0, 0], {
    radius: 1,
    color: "#1d6bf3",
    weight: 1,
    fillColor: "#1d6bf3",
    fillOpacity: 0.15,
    interactive: false,
  });
  let following = false;
  let centred = false;
  let button: HTMLButtonElement;
  let buttonText: HTMLSpanElement;
  let status: HTMLDivElement;

  function show(label: string, isError = false) {
    status.textContent = label;
    status.style.color = isError ? "#b91c1c" : "#0f172a";
    status.style.display = label ? "block" : "none";
  }

  function stop() {
    following = false;
    centred = false;
    map.stopLocate();
    dot.remove();
    accuracy.remove();
    button.setAttribute("aria-pressed", "false");
    buttonText.textContent = texts.show;
    show("");
  }

  function start() {
    following = true;
    centred = false;
    button.setAttribute("aria-pressed", "true");
    buttonText.textContent = texts.stop;
    show(texts.finding);
    map.locate({ watch: true, setView: false, enableHighAccuracy: true, maximumAge: 0 });
  }

  map.on("locationfound", (event: L.LocationEvent) => {
    if (!following) return;
    dot.setLatLng(event.latlng).addTo(map);
    accuracy.setLatLng(event.latlng).setRadius(event.accuracy).addTo(map);
    show(texts.here(Math.round(event.accuracy)));
    // Move the map to the person once; after that only the dot moves, so drawing is not disturbed.
    if (!centred) {
      centred = true;
      map.setView(event.latlng, Math.max(map.getZoom(), 18));
    }
  });
  map.on("locationerror", () => {
    stop();
    show(texts.failed, true);
  });

  const Locate = L.Control.extend({
    onAdd() {
      const bar = L.DomUtil.create("div", "leaflet-bar leaflet-control");
      bar.style.background = "#fff";
      bar.style.maxWidth = "16rem";
      button = L.DomUtil.create("button", "", bar) as HTMLButtonElement;
      button.type = "button";
      button.setAttribute("aria-pressed", "false");
      button.style.cssText =
        "display:flex;align-items:center;gap:8px;min-height:40px;padding:0 12px;width:100%;" +
        "background:#fff;border:0;cursor:pointer;font:600 14px/1.2 inherit;color:#0f172a;";
      button.innerHTML = LOCATE_ICON;
      buttonText = L.DomUtil.create("span", "", button);
      buttonText.textContent = texts.show;
      status = L.DomUtil.create("div", "", bar) as HTMLDivElement;
      status.setAttribute("role", "status");
      status.style.cssText =
        "display:none;padding:6px 12px 8px;font:500 13px/1.3 inherit;border-top:1px solid #e2e8f0;";
      L.DomEvent.disableClickPropagation(bar);
      L.DomEvent.on(button, "click", () => (following ? stop() : start()));
      return bar;
    },
  });
  new Locate({ position: "topright" }).addTo(map);
  map.on("unload", () => map.stopLocate());
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
  const { t } = useTranslation();
  const textsRef = useRef(t);
  textsRef.current = t;
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
    const street = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    });
    const satellite = L.tileLayer(SATELLITE_URL, {
      maxZoom: 19,
      maxNativeZoom: 18,
      attribution: SATELLITE_CREDIT,
    });
    (savedLayerIsSatellite() ? satellite : street).addTo(map);
    const text = textsRef.current;
    L.control
      .layers(
        {
          [text("plants.geofence.layerMap")]: street,
          [text("plants.geofence.layerSatellite")]: satellite,
        },
        undefined,
        { position: "topright", collapsed: false },
      )
      .addTo(map);
    map.on("baselayerchange", (event: L.LayersControlEvent) =>
      saveLayerChoice(event.layer === satellite),
    );
    addLocateControl(map, {
      show: text("plants.geofence.locate"),
      stop: text("plants.geofence.locateStop"),
      finding: text("plants.geofence.locating"),
      failed: text("plants.geofence.locateFailed"),
      here: (metres) => text("plants.geofence.youAreHere", { metres }),
    });
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
      // The drawing tools are picture-only links: give each one a name for screen readers.
      const toolNames = {
        polygon: text("plants.geofence.toolPolygon"),
        circle: text("plants.geofence.toolCircle"),
        edit: text("plants.geofence.toolEdit"),
        delete: text("plants.geofence.toolRemove"),
      };
      for (const [tool, name] of Object.entries(toolNames)) {
        const link = containerRef.current.querySelector(`.leaflet-pm-icon-${tool}`)?.closest("a");
        link?.setAttribute("aria-label", name);
        link?.setAttribute("title", name);
      }
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
