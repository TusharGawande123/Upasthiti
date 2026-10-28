// "Why paused?" (F-53, design gate A): a small drawing of the plant fence, its margin and this
// device's position with its accuracy circle, so the installer sees at once whether the device is
// outside or only has a weak signal. Plain SVG from the fence the heartbeat sent: no map tiles, so
// it also works without internet.
import { Map as MapIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { fenceCentre, fenceRing, type GateFence, projector } from "./fence-distance";
import type { Reading } from "./gate-location";

const SIZE = 320; // the drawing's own units; the SVG scales to its box
const PADDING = 24;

export function FenceSketch({
  fence,
  reading,
  distanceM,
  accuracyLimitM,
  weak,
}: {
  fence: GateFence;
  reading: Reading;
  distanceM: number | null;
  accuracyLimitM: number;
  weak: boolean;
}) {
  const { t } = useTranslation();
  const [lon0, lat0] = fenceCentre(fence);
  const toMetres = projector(lon0, lat0);
  const device = toMetres(reading.lon, reading.lat);
  const corners =
    fence.shape === "polygon" ? fenceRing(fence).map(([lon, lat]) => toMetres(lon, lat)) : [];
  const radius = fence.radius_m ?? 0;

  // Fit the fence, its margin, the device and its accuracy circle into the drawing.
  const reach = Math.max(
    radius + fence.buffer_m,
    ...corners.map((corner) => Math.hypot(corner.x, corner.y) + fence.buffer_m),
    Math.hypot(device.x, device.y) + reading.accuracyM,
    1,
  );
  const scale = (SIZE / 2 - PADDING) / reach;
  // SVG y grows downwards, north is up.
  const at = (x: number, y: number) => ({ x: SIZE / 2 + x * scale, y: SIZE / 2 - y * scale });
  const point = at(device.x, device.y);
  const polygon = corners.map((corner) => at(corner.x, corner.y));
  const polygonPoints = polygon.map((corner) => `${corner.x},${corner.y}`).join(" ");

  const line = weak
    ? t("kiosk.location.sketch.weakLine", {
        now: Math.round(reading.accuracyM),
        needed: accuracyLimitM,
      })
    : t("kiosk.location.sketch.outsideLine", { metres: Math.round(distanceM ?? 0) });

  return (
    <figure className="w-full rounded-3xl border-2 border-foreground bg-card p-5">
      <figcaption className="mb-3 flex items-center gap-3 text-[28px] font-extrabold">
        <MapIcon className="size-8" aria-hidden />
        {t("kiosk.location.sketch.title")}
      </figcaption>
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="mx-auto block aspect-square w-full max-w-[22rem] rounded-2xl border bg-muted"
        role="img"
        aria-label={line}
      >
        {fence.shape === "circle" ? (
          <>
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={(radius + fence.buffer_m) * scale}
              className="fill-none stroke-warning"
              strokeWidth={3}
              strokeDasharray="10 8"
            />
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={radius * scale}
              className="fill-primary/15 stroke-primary"
              strokeWidth={5}
            />
          </>
        ) : (
          <>
            <polygon
              points={polygonPoints}
              className="fill-none stroke-warning/40"
              strokeWidth={fence.buffer_m * scale * 2}
              strokeLinejoin="round"
            />
            <polygon
              points={polygonPoints}
              className="fill-primary/15 stroke-primary"
              strokeWidth={5}
            />
          </>
        )}
        <circle
          cx={point.x}
          cy={point.y}
          r={Math.max(reading.accuracyM * scale, 6)}
          className="fill-warning/25 stroke-foreground"
          strokeWidth={2}
        />
        <circle
          cx={point.x}
          cy={point.y}
          r={accuracyLimitM * scale}
          className="fill-none stroke-foreground"
          strokeWidth={2}
          strokeDasharray="4 6"
        />
        <circle
          cx={point.x}
          cy={point.y}
          r={8}
          className="fill-foreground stroke-card"
          strokeWidth={3}
        />
      </svg>
      <p className="mt-4 text-[32px] leading-tight font-extrabold">{line}</p>
      <ul className="mt-3 grid gap-x-6 gap-y-2 text-[24px] sm:grid-cols-2">
        <li>{t("kiosk.location.sketch.fence")}</li>
        <li>{t("kiosk.location.sketch.margin")}</li>
        <li>{t("kiosk.location.sketch.device")}</li>
        <li>{t("kiosk.location.sketch.needed")}</li>
      </ul>
    </figure>
  );
}
