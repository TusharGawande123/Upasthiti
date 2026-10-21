// Same clock on every kiosk: the server's time shown in IST, never the device's own setting.
// `offsetMs` is how far the server clock is ahead of this device (measured at each answer).
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export function useServerNow(offsetMs: number): Date {
  const [now, setNow] = useState(() => new Date(Date.now() + offsetMs));
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date(Date.now() + offsetMs)), 1000);
    return () => clearInterval(timer);
  }, [offsetMs]);
  return now;
}

export function formatIstTime(moment: Date, withSeconds = true): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    second: withSeconds ? "2-digit" : undefined,
    // "h23" on purpose: with hour12:false some browsers write midnight as 24:30 (night shifts).
    hourCycle: "h23",
  }).format(moment);
}

export function ServerClock({ offsetMs }: { offsetMs: number }) {
  const { t } = useTranslation();
  const now = useServerNow(offsetMs);
  const date = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(now);

  return (
    <div>
      <p
        role="timer"
        aria-label={t("kiosk.paired.clockLabel")}
        className="tnum text-[88px] leading-none font-extrabold"
      >
        {formatIstTime(now)}
      </p>
      <p className="mt-2 text-[24px] text-muted-foreground">
        {t("kiosk.paired.clockCaption", { date })}
      </p>
    </div>
  );
}
