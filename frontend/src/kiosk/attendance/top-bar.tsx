// Parts of the kiosk top bar on the attendance screens (design gate B): the connection chip and
// the live server clock in IST.
import { Wifi, WifiOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatIstTime, useServerNow } from "../components/server-clock";
import { StatusChip } from "../components/status-chip";

export function ConnectionChip({ online }: { online: boolean }) {
  const { t } = useTranslation();
  return online ? (
    <StatusChip tone="success" icon={Wifi}>
      {t("kiosk.attendance.online")}
    </StatusChip>
  ) : (
    <StatusChip tone="danger" icon={WifiOff}>
      {t("kiosk.attendance.offline")}
    </StatusChip>
  );
}

export function TopClock({ offsetMs }: { offsetMs: number }) {
  const { t } = useTranslation();
  const now = useServerNow(offsetMs);
  return (
    <p className="text-right" role="timer" aria-label={t("kiosk.paired.clockLabel")}>
      <span className="tnum block text-[44px] leading-none font-extrabold tracking-tight">
        {formatIstTime(now)}
      </span>
      <span className="block text-[24px] font-semibold text-muted-foreground">
        {t("kiosk.attendance.ist")}
      </span>
    </p>
  );
}
