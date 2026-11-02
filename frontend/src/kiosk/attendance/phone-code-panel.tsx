// The phone code panel of the gate idle screen (spec M4b §4.2, design gate P2 screen 1).
// 768 px and wider: a card with the QR code, the heading "Phone code", one sentence and a thin bar
// that shows the time left. Narrower (a phone used as the gate): a button "Phone code" that shows
// the code full width for `show_seconds`, then goes back by itself, so the card-reading camera
// stays large. Offline or no fresh code: "Phone code not available now. Show your ID card."
// The panel is only drawn on the idle screen; a punch in progress hides it.
import { Smartphone, SmartphoneNfc } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { KioskButton } from "../components/kiosk-button";
import { type GateCode, useGateCode } from "./use-gate-code";

const WIDE_QUERY = "(min-width: 768px)";

function useIsWide(): boolean {
  const [wide, setWide] = useState(() => window.matchMedia?.(WIDE_QUERY).matches ?? true);
  useEffect(() => {
    const query = window.matchMedia?.(WIDE_QUERY);
    if (!query) return;
    const update = () => setWide(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return wide;
}

// The share of the code's life that is left, redrawn twice a second.
function useShareLeft(code: GateCode | null, serverOffsetMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!code) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [code]);
  if (!code) return 0;
  const issued = new Date(code.issued_at).getTime();
  const expires = new Date(code.expires_at).getTime();
  const left = expires - (now + serverOffsetMs);
  return Math.max(0, Math.min(1, left / Math.max(1, expires - issued)));
}

function CodePicture({ svg, size }: { svg: string; size: number }) {
  const { t } = useTranslation();
  // An <img> never runs scripts, even if the picture text were changed on the way.
  return (
    <img
      alt={t("kiosk.phoneCode.alt")}
      src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`}
      width={size}
      height={size}
      className="shrink-0 rounded-lg border-2 border-foreground bg-white p-2"
    />
  );
}

function TimeBar({ share, secondsLeft }: { share: number; secondsLeft: number }) {
  const { t } = useTranslation();
  const ending = secondsLeft <= 5;
  return (
    <div
      role="timer"
      aria-label={t("kiosk.phoneCode.timer", { count: secondsLeft })}
      className="h-3 w-full overflow-hidden rounded-full bg-muted"
    >
      <div
        className={
          ending
            ? "h-full bg-[repeating-linear-gradient(135deg,#8f5300_0_8px,#0e1726_8px_16px)]"
            : "h-full bg-primary"
        }
        style={{ width: `${Math.round(share * 100)}%` }}
      />
    </div>
  );
}

export function PhoneCodePanel({
  enabled,
  online,
  idle,
  showSeconds,
  serverOffsetMs,
}: {
  enabled: boolean;
  online: boolean;
  /** True only on the idle scanning screen. */
  idle: boolean;
  showSeconds: number;
  serverOffsetMs: number;
}) {
  const { t } = useTranslation();
  const wide = useIsWide();
  const state = useGateCode(enabled && online && idle);
  const code = state.kind === "code" ? state.code : null;
  const share = useShareLeft(code, serverOffsetMs);
  const [openSeconds, setOpenSeconds] = useState<number | null>(null);

  // The full-screen code closes by itself after `showSeconds`, or when a punch starts.
  useEffect(() => {
    if (openSeconds === null) return;
    if (!idle || openSeconds <= 0) {
      setOpenSeconds(null);
      return;
    }
    const timer = setTimeout(() => setOpenSeconds(openSeconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [openSeconds, idle]);

  if (!enabled || !idle) return null;
  if (state.kind === "off" && online) return null;

  const expired = code !== null && share <= 0;
  const unavailable = !online || state.kind === "unavailable" || expired || state.kind === "off";
  const secondsLeft = code
    ? Math.ceil(
        (share * (new Date(code.expires_at).getTime() - new Date(code.issued_at).getTime())) / 1000,
      )
    : 0;

  if (unavailable || !code) {
    return (
      <p
        role="status"
        className="mt-4 flex items-center gap-3 rounded-2xl border-4 border-dashed border-muted-foreground bg-muted p-4 text-[24px] font-bold text-muted-foreground"
      >
        <SmartphoneNfc className="size-8 shrink-0" aria-hidden />
        {t("kiosk.phoneCode.notAvailable")}
      </p>
    );
  }

  if (!wide) {
    if (openSeconds !== null && code.svg) {
      return (
        <div className="fixed inset-0 z-40 flex flex-col items-center gap-4 overflow-y-auto bg-background p-4">
          <h2 className="w-full bg-foreground p-4 text-center text-[34px] font-extrabold text-white">
            {t("kiosk.phoneCode.title")}
          </h2>
          <CodePicture svg={code.svg} size={Math.min(320, window.innerWidth - 48)} />
          <p className="text-center text-[26px] font-bold">{t("kiosk.phoneCode.line")}</p>
          <TimeBar share={share} secondsLeft={secondsLeft} />
          <p className="text-[24px]">{t("kiosk.result.backIn", { count: openSeconds })}</p>
          <KioskButton variant="key" onClick={() => setOpenSeconds(null)}>
            {t("kiosk.phoneCode.back")}
          </KioskButton>
        </div>
      );
    }
    return (
      <KioskButton variant="key" className="mt-4" onClick={() => setOpenSeconds(showSeconds)}>
        <Smartphone className="size-8" aria-hidden />
        {t("kiosk.phoneCode.title")}
      </KioskButton>
    );
  }

  return (
    <section
      aria-label={t("kiosk.phoneCode.title")}
      className="mt-4 flex flex-wrap items-center gap-6 rounded-[20px] border-4 border-foreground bg-card p-4 shadow-[0_6px_0_0_#0e1726]"
    >
      {code.svg ? <CodePicture svg={code.svg} size={220} /> : null}
      <div className="min-w-0 flex-1 space-y-3">
        <h2 className="flex items-center gap-3 text-[32px] font-extrabold">
          <Smartphone className="size-9" aria-hidden />
          {t("kiosk.phoneCode.title")}
        </h2>
        <p className="text-[24px]">{t("kiosk.phoneCode.line")}</p>
        <TimeBar share={share} secondsLeft={secondsLeft} />
      </div>
    </section>
  );
}
