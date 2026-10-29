// The detail drawer of one attendance device (M4 spec §4.7): its facts from the last heartbeat and
// the health monitor (F-3): battery, camera, storage, app version and a 7-day timeline of online
// and offline stretches. Read-only; everyone who may see the device sees this.
import { BatteryCharging, BatteryFull, Camera, HardDrive, MapPin, Smartphone } from "lucide-react";
import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { Alert } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { describeError } from "@/features/auth/error-message";
import { useGeofenceVersions } from "@/features/plants/use-plants";
import type { MapPoint } from "@/features/review/review-map";
import { formatDate, formatTime } from "@/lib/format";
import { DeviceStateBadge } from "./device-state";
import { type HealthDay, type Kiosk, useKioskHealth } from "./use-kiosks";

// Leaflet is big: loaded only when a drawer with a position opens.
const ReviewMap = lazy(() =>
  import("@/features/review/review-map").then((m) => ({ default: m.ReviewMap })),
);

const DAY_MINUTES = 24 * 60;

function minutesIntoDay(moment: string, day: string): number {
  // The timeline is drawn on the IST day: minutes since 00:00 IST of that day.
  const start = new Date(`${day}T00:00:00+05:30`).getTime();
  return Math.min(DAY_MINUTES, Math.max(0, (new Date(moment).getTime() - start) / 60_000));
}

function DayBar({ day }: { day: HealthDay }) {
  const { t } = useTranslation();
  const known = day.online_minutes + day.offline_minutes;
  return (
    <li className="space-y-1">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="tnum font-semibold">{formatDate(`${day.date}T06:00:00+05:30`)}</span>
        <span className="text-muted-foreground">
          {known === 0
            ? t("kiosks.health.noData")
            : t("kiosks.health.dayLine", {
                online: Math.round((day.online_minutes / known) * 100),
              })}
        </span>
      </div>
      <div
        role="img"
        aria-label={t("kiosks.health.dayLabel", {
          online: day.online_minutes,
          offline: day.offline_minutes,
        })}
        className="relative h-3 overflow-hidden rounded-full bg-muted"
      >
        {day.stretches.map((stretch) => {
          const from = minutesIntoDay(stretch.start, day.date);
          const to = minutesIntoDay(stretch.end, day.date);
          return (
            <span
              key={`${stretch.start}-${stretch.state}`}
              className={
                stretch.state === "online"
                  ? "absolute inset-y-0 bg-success"
                  : "absolute inset-y-0 bg-muted-foreground/50"
              }
              style={{
                left: `${(from / DAY_MINUTES) * 100}%`,
                width: `${((to - from) / DAY_MINUTES) * 100}%`,
              }}
            />
          );
        })}
      </div>
    </li>
  );
}

function Fact({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Camera;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 py-2">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="text-sm font-semibold">{children}</dd>
      </div>
    </div>
  );
}

/**
 * The device's last position against the plant's current fence. The server sends the position
 * only to the Super Admin and the plant's own Plant Head, so the map shows only for them.
 */
function LastPositionMap({ plantId, point }: { plantId: string; point: MapPoint }) {
  const { t } = useTranslation();
  const versions = useGeofenceVersions(plantId);
  const fence = versions.data?.find((version) => version.is_current) ?? null;
  return (
    <div className="py-2">
      <Suspense fallback={<Skeleton className="h-72 w-full" />}>
        <ReviewMap
          fence={
            fence
              ? {
                  shape: fence.shape,
                  geojson: fence.geojson,
                  radius_m: fence.radius_m ? Number(fence.radius_m) : undefined,
                }
              : null
          }
          marginM={fence?.buffer_m ?? 0}
          points={[point]}
          label={t("kiosks.drawer.mapLabel")}
        />
      </Suspense>
    </div>
  );
}

export function DeviceDrawer({ kiosk, onClose }: { kiosk: Kiosk; onClose: () => void }) {
  const { t } = useTranslation();
  const health = useKioskHealth(kiosk.id);
  const latest = health.data?.latest;
  const battery = latest?.battery ?? kiosk.battery;
  const storage = latest?.storage ?? kiosk.storage;
  const camera = latest?.camera_ok ?? kiosk.camera_ok;
  const location = kiosk.location;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        aria-describedby="device-drawer-state"
        className="top-0 right-0 left-auto h-dvh max-h-dvh w-full max-w-[520px] translate-x-0 translate-y-0 overflow-y-auto rounded-none p-5 data-[state=open]:slide-in-from-right-8"
      >
        <DialogTitle>{kiosk.name}</DialogTitle>
        <DialogDescription id="device-drawer-state" asChild>
          <div className="mt-1">
            <DeviceStateBadge kiosk={kiosk} />
          </div>
        </DialogDescription>

        <dl className="mt-4 divide-y">
          <Fact icon={Smartphone} label={t("kiosks.drawer.lastContact")}>
            {kiosk.last_contact_at
              ? `${formatDate(kiosk.last_contact_at)}, ${formatTime(kiosk.last_contact_at)}`
              : t("kiosks.never")}
          </Fact>
          <Fact icon={Smartphone} label={t("kiosks.drawer.lastPunch")}>
            {kiosk.last_punch_at
              ? `${formatDate(kiosk.last_punch_at)}, ${formatTime(kiosk.last_punch_at)}`
              : "–"}
          </Fact>
          <Fact icon={Smartphone} label={t("kiosks.drawer.waiting")}>
            {kiosk.queue && kiosk.queue.count > 0
              ? t("kiosks.drawer.waitingSince", {
                  count: kiosk.queue.count,
                  time: kiosk.queue.oldest_punch_at ? formatTime(kiosk.queue.oldest_punch_at) : "–",
                })
              : "–"}
          </Fact>
          <Fact icon={MapPin} label={t("kiosks.drawer.location")}>
            {location?.state
              ? t(`kiosks.drawer.locationState.${location.inside ?? "unknown"}`, {
                  metres: Math.round(location.accuracy_m ?? 0),
                })
              : "–"}
            {location?.lat != null && location.lon != null ? (
              <span className="tnum block text-xs font-normal text-muted-foreground">
                {location.lat}, {location.lon}
              </span>
            ) : null}
          </Fact>
          {location?.lat != null && location.lon != null ? (
            <LastPositionMap
              plantId={kiosk.plant_id}
              point={{ lat: location.lat, lon: location.lon, accuracy_m: location.accuracy_m }}
            />
          ) : null}
          <Fact
            icon={battery?.charging ? BatteryCharging : BatteryFull}
            label={t("kiosks.health.battery")}
          >
            {battery
              ? t(
                  battery.charging ? "kiosks.health.batteryCharging" : "kiosks.health.batteryLevel",
                  {
                    percent: Math.round(battery.level * 100),
                  },
                )
              : t("kiosks.health.notReported")}
          </Fact>
          <Fact icon={Camera} label={t("kiosks.health.camera")}>
            {camera == null
              ? t("kiosks.health.notReported")
              : t(camera ? "kiosks.health.cameraWorking" : "kiosks.health.cameraNotWorking")}
          </Fact>
          <Fact icon={HardDrive} label={t("kiosks.health.storage")}>
            {storage?.quota_mb != null
              ? t("kiosks.health.storageLine", {
                  used: storage.usage_mb ?? 0,
                  free: Math.max(0, storage.quota_mb - (storage.usage_mb ?? 0)),
                })
              : t("kiosks.health.notReported")}
            <span className="block text-xs font-normal text-muted-foreground">
              {storage?.offline_ready == null
                ? null
                : t(
                    storage.offline_ready
                      ? "kiosks.health.offlineReady"
                      : "kiosks.health.offlineOff",
                  )}
              {storage?.persisted === false ? ` · ${t("kiosks.health.notPersisted")}` : null}
            </span>
          </Fact>
          <Fact icon={Smartphone} label={t("kiosks.columns.version")}>
            {latest?.app_version ?? kiosk.app_version ?? "–"}
          </Fact>
        </dl>

        <section className="mt-5" aria-labelledby="health-timeline">
          <h2 id="health-timeline" className="text-sm font-bold">
            {t("kiosks.health.timeline")}
          </h2>
          <p className="mb-3 text-xs text-muted-foreground">{t("kiosks.health.timelineHelp")}</p>
          {health.isPending ? <Skeleton className="h-32 w-full" /> : null}
          {health.isError ? <Alert tone="danger">{describeError(health.error, t)}</Alert> : null}
          {health.data ? (
            <ul className="space-y-3">
              {health.data.days.map((day) => (
                <DayBar key={day.date} day={day} />
              ))}
            </ul>
          ) : null}
        </section>
      </DialogContent>
    </Dialog>
  );
}
