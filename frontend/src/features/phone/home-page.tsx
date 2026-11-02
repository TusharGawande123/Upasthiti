// The phone home (spec M4b §4.8, design gate P1 screen 5): greeting, today's last punch, the
// location chip, ONE big button for the employee's punch method, and the links "My attendance",
// "Sign in faster with a passkey" and "Add to home screen" (F-74). The phone reads its location
// only while this page is open and when a punch starts; it never tracks in the background.
import {
  CalendarDays,
  Fingerprint,
  Globe,
  LogIn,
  LogOut,
  MapPin,
  MapPinOff,
  QrCode,
  ScanFace,
  Smartphone,
  SquarePlus,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { measureLocation } from "@/kiosk/location";
import { distanceToFenceM } from "@/kiosk/location/fence-distance";
import { formatDate, formatTime } from "@/lib/format";
import { passkeysSupported } from "./passkey-support";
import type { PhoneMe } from "./phone-api";
import { Notice, PhoneCard } from "./phone-ui";
import { usePhoneMe } from "./use-phone";

type ChipState = "finding" | "ready" | "off" | "weak" | "not_at_plant";

/** One fresh reading while the page is open; what the chip says follows spec §4.8. */
function useLocationChip(me: PhoneMe | undefined): { state: ChipState; accuracyM: number | null } {
  const [chip, setChip] = useState<{ state: ChipState; accuracyM: number | null }>({
    state: "finding",
    accuracyM: null,
  });
  const limit = me?.settings.gps_accuracy_limit_m;
  const fence = me?.geofence ?? null;
  const isCardWorker = me?.employee.punch_method === "qr";
  useEffect(() => {
    if (limit === undefined) return;
    let cancelled = false;
    measureLocation({ maxWaitMs: 12_000 })
      .then((reading) => {
        if (cancelled) return;
        if (reading.accuracy_m > limit) {
          return setChip({ state: "weak", accuracyM: reading.accuracy_m });
        }
        const away = fence ? distanceToFenceM(fence, reading.lat, reading.lon) : 0;
        const outside = isCardWorker && fence !== null && away > fence.buffer_m;
        setChip({ state: outside ? "not_at_plant" : "ready", accuracyM: reading.accuracy_m });
      })
      .catch(() => {
        if (!cancelled) setChip({ state: "off", accuracyM: null });
      });
    return () => {
      cancelled = true;
    };
  }, [limit, fence, isCardWorker]);
  return chip;
}

function LocationChip({ state, accuracyM }: { state: ChipState; accuracyM: number | null }) {
  const { t } = useTranslation();
  if (state === "finding") {
    return (
      <Notice tone="info" icon={MapPin}>
        {t("phone.home.location.finding")}
      </Notice>
    );
  }
  if (state === "ready") {
    return (
      <Notice tone="success" icon={MapPin}>
        {t("phone.home.location.ready")}
      </Notice>
    );
  }
  if (state === "off") {
    return (
      <Notice tone="warning" icon={MapPinOff}>
        {t("phone.home.location.off")}
      </Notice>
    );
  }
  if (state === "weak") {
    return (
      <Notice tone="warning" icon={MapPinOff}>
        {t("phone.home.location.weak", { meters: accuracyM })}
      </Notice>
    );
  }
  return (
    <Notice tone="danger" icon={MapPinOff}>
      {t("phone.home.location.notAtPlant")}
    </Notice>
  );
}

// Chrome offers "install" through this event; the button appears only then.
type InstallPrompt = Event & { prompt: () => Promise<void> };

export function PhoneHomePage() {
  const { t } = useTranslation();
  const me = usePhoneMe().data;
  const chip = useLocationChip(me);
  const [passkeyOffered, setPasskeyOffered] = useState(false);
  const [install, setInstall] = useState<InstallPrompt | null>(null);

  useEffect(() => {
    void passkeysSupported().then(setPasskeyOffered);
    const remember = (event: Event) => {
      event.preventDefault();
      setInstall(event as InstallPrompt);
    };
    window.addEventListener("beforeinstallprompt", remember);
    return () => window.removeEventListener("beforeinstallprompt", remember);
  }, []);

  if (!me) return null;
  const isFace = me.employee.punch_method === "face";
  const faceNotReady = isFace && !me.ready.face;
  const last = me.today.last_punch;
  const until = me.access.outside_work_until;

  return (
    <>
      <PhoneCard className="flex items-center gap-4">
        <span
          aria-hidden
          className="grid size-14 shrink-0 place-items-center rounded-full bg-primary text-xl font-bold text-primary-foreground"
        >
          {me.employee.first_name.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold">
            {t("phone.home.hello", { name: me.employee.first_name })}
          </h1>
          <p className="text-lg text-muted-foreground">{me.employee.plant.name}</p>
        </div>
      </PhoneCard>

      <PhoneCard className="space-y-2">
        <p className="text-base font-semibold text-muted-foreground">{t("phone.home.today")}</p>
        {last ? (
          <p className="flex flex-wrap items-center gap-2 text-xl font-bold">
            {last.direction === "in" ? <LogIn aria-hidden /> : <LogOut aria-hidden />}
            {t("phone.home.lastPunch", {
              direction: t(last.direction === "in" ? "phone.in" : "phone.out"),
              time: formatTime(last.time),
            })}
            <span className="inline-flex items-center gap-1 rounded-full border px-3 py-0.5 text-base font-semibold">
              {last.channel === "phone" ? (
                <Smartphone className="size-4" aria-hidden />
              ) : (
                <Globe className="size-4" aria-hidden />
              )}
              {t(last.channel === "phone" ? "phone.home.via.phone" : "phone.home.via.device")}
            </span>
          </p>
        ) : (
          <p className="text-xl font-bold">{t("phone.home.none")}</p>
        )}
      </PhoneCard>

      {isFace && me.access.outside_work_allowed ? (
        <div className="rounded-lg border-2 border-dashed border-primary bg-primary-soft p-4 text-lg font-semibold text-primary-soft-foreground">
          <p>{t("phone.home.outsideAllowed")}</p>
          {until ? (
            <p className="font-normal">
              {t("phone.home.outsideUntil", { date: formatDate(`${until}T00:00:00+05:30`) })}
            </p>
          ) : null}
        </div>
      ) : null}

      <LocationChip state={chip.state} accuracyM={chip.accuracyM} />

      {faceNotReady ? (
        <Notice tone="warning" icon={TriangleAlert}>
          {t("errors.PHONE_FACE_NOT_READY")}
        </Notice>
      ) : (
        <Link
          to={isFace ? "/phone/punch/face" : "/phone/punch/gate-code"}
          className="flex h-21 w-full items-center justify-center gap-3 rounded-xl bg-primary text-2xl font-bold text-primary-foreground shadow-md"
        >
          {isFace ? (
            <ScanFace className="size-8" aria-hidden />
          ) : (
            <QrCode className="size-8" aria-hidden />
          )}
          {t(isFace ? "phone.home.punchFace" : "phone.home.scanGateCode")}
        </Link>
      )}

      <ul className="space-y-2">
        <li>
          <Link
            to="/phone/attendance"
            className="flex h-15 items-center gap-3 rounded-lg border bg-card px-4 text-lg font-semibold"
          >
            <CalendarDays aria-hidden />
            {t("phone.home.myAttendance")}
          </Link>
        </li>
        {passkeyOffered ? (
          <li>
            <Link
              to="/phone/passkey"
              className="flex h-15 items-center gap-3 rounded-lg border bg-card px-4 text-lg font-semibold"
            >
              <Fingerprint aria-hidden />
              {t("phone.home.passkeyLink")}
            </Link>
          </li>
        ) : null}
        {install ? (
          <li>
            <button
              type="button"
              onClick={() => void install.prompt()}
              className="flex h-15 w-full items-center gap-3 rounded-lg border bg-card px-4 text-left text-lg font-semibold"
            >
              <SquarePlus aria-hidden />
              {t("phone.home.addToHome")}
            </button>
          </li>
        ) : null}
      </ul>
    </>
  );
}
