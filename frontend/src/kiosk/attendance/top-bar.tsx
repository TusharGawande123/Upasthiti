// Parts of the kiosk top bar on the attendance screens (design gate B): the connection chip and
// the live server clock in IST.
import { CloudUpload, Hourglass, Wifi, WifiOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatIstTime, useServerNow } from "../components/server-clock";
import { StatusChip } from "../components/status-chip";

export function ConnectionChip({
  online,
  savesOffline = false,
}: {
  online: boolean;
  /** Offline punches are saved on this device (M4), so the honest text says so. */
  savesOffline?: boolean;
}) {
  const { t } = useTranslation();
  if (!online && savesOffline) {
    return (
      <StatusChip tone="warning" icon={WifiOff}>
        {t("kiosk.offline.chipOffline")}
      </StatusChip>
    );
  }
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

/** "12 saved" while punches wait on the device, "Sending…" while they are being sent (spec §4.2). */
export function QueueChip({ count, sending }: { count: number; sending: boolean }) {
  const { t } = useTranslation();
  if (count === 0) return null;
  return sending ? (
    <StatusChip tone="neutral" icon={CloudUpload}>
      {t("kiosk.offline.chipSending", { count })}
    </StatusChip>
  ) : (
    <StatusChip tone="neutral" icon={Hourglass}>
      {t("kiosk.offline.chipWaiting", { count })}
    </StatusChip>
  );
}

export function TopClock({ offsetMs }: { offsetMs: number }) {
  const { t } = useTranslation();
  const now = useServerNow(offsetMs);
  return (
    <p className="text-right" role="timer" aria-label={t("kiosk.paired.clockLabel")}>
      <span className="tnum block text-[36px] leading-none font-extrabold tracking-tight sm:text-[44px]">
        {formatIstTime(now)}
      </span>
      <span className="block text-[24px] font-semibold text-muted-foreground">
        {t("kiosk.attendance.ist")}
      </span>
    </p>
  );
}
