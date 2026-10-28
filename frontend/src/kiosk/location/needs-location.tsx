// The gate's location on screen (M4 spec §4.1, design gate A): the chip in the top bar and the
// "This attendance device needs its location" screen that replaces the camera area while
// punching is paused. The screen goes away by itself when a good reading arrives (no tap).
import {
  LoaderCircle,
  LocateFixed,
  LocateOff,
  MapPinned,
  MapPinOff,
  SatelliteDish,
  ShieldOff,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { StatusChip } from "../components/status-chip";
import { FenceSketch } from "./fence-sketch";
import {
  type GateLocation,
  type KioskLocationSettings,
  type LocationState,
  pauseCode,
} from "./gate-location";

export function LocationChip({ place }: { place: GateLocation }) {
  const { t } = useTranslation();
  const accuracy = place.reading ? Math.round(place.reading.accuracyM) : 0;
  const chips: Record<LocationState, React.ReactNode> = {
    finding: (
      <StatusChip tone="neutral" icon={LoaderCircle}>
        {t("kiosk.location.chip.finding")}
      </StatusChip>
    ),
    good: (
      <StatusChip tone="success" icon={LocateFixed}>
        {t("kiosk.location.chip.good", { metres: accuracy })}
      </StatusChip>
    ),
    stale: (
      <StatusChip tone="warning" icon={MapPinned}>
        {t("kiosk.location.chip.stale")}
      </StatusChip>
    ),
    weak: (
      <StatusChip tone="warning" icon={SatelliteDish}>
        {t("kiosk.location.chip.weak", { metres: accuracy })}
      </StatusChip>
    ),
    outside: (
      <StatusChip tone="danger" icon={MapPinOff}>
        {t("kiosk.location.chip.none")}
      </StatusChip>
    ),
    none: (
      <StatusChip tone="danger" icon={LocateOff}>
        {t("kiosk.location.chip.none")}
      </StatusChip>
    ),
    denied: (
      <StatusChip tone="danger" icon={LocateOff}>
        {t("kiosk.location.chip.none")}
      </StatusChip>
    ),
  };
  return chips[place.state];
}

const CAUSE_ICONS = {
  LOCATION_DENIED: ShieldOff,
  LOCATION_UNAVAILABLE: LocateOff,
  LOCATION_WEAK: SatelliteDish,
  LOCATION_OUTSIDE: MapPinOff,
};

export function NeedsLocationScreen({
  place,
  settings,
}: {
  place: GateLocation;
  settings: KioskLocationSettings;
}) {
  const { t } = useTranslation();
  const code = pauseCode(place.state) as keyof typeof CAUSE_ICONS;
  const CauseIcon = CAUSE_ICONS[code];
  const showSketch =
    settings.geofence !== null &&
    place.reading !== null &&
    (place.state === "weak" || place.state === "outside");
  return (
    <div role="alert" className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      {showSketch && settings.geofence && place.reading ? (
        <FenceSketch
          fence={settings.geofence}
          reading={place.reading}
          distanceM={place.distanceM}
          accuracyLimitM={settings.accuracy_limit_m}
          weak={place.state === "weak"}
        />
      ) : null}
      <div className="flex items-center gap-5 rounded-3xl border-2 border-foreground bg-card p-5">
        <span className="grid size-20 shrink-0 place-items-center rounded-2xl border-2 border-foreground bg-signal">
          <MapPinOff className="size-11" aria-hidden />
        </span>
        <h1 className="text-[36px] leading-tight font-extrabold sm:text-[44px]">
          {t("kiosk.location.title")}
        </h1>
      </div>
      <p className="text-[28px] leading-snug font-semibold">{t("kiosk.location.message")}</p>
      <p className="flex items-start gap-4 rounded-2xl border-2 border-warning bg-warning-soft p-5 text-[28px] leading-snug font-bold">
        <CauseIcon className="mt-1 size-9 shrink-0" aria-hidden />
        {t(`kiosk.location.cause.${code}`, {
          now: place.reading ? Math.round(place.reading.accuracyM) : 0,
          needed: settings.accuracy_limit_m,
        })}
      </p>
      <p className="flex items-center gap-3 text-[24px] text-muted-foreground" aria-live="polite">
        <LoaderCircle className="size-7 animate-spin motion-reduce:animate-none" aria-hidden />
        {t("kiosk.location.checkingAgain")}
      </p>
      <p className="text-[24px] text-muted-foreground">
        {t("kiosk.problem.forAdmin")} <b className="text-foreground">{code}</b>
      </p>
    </div>
  );
}
