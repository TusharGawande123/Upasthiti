// The state of an attendance device as a badge: always an icon AND a word, never colour alone
// (M4 spec §4.7). The server works the state out when asked; nothing here decides it.
import { Ban, CircleCheck, CloudUpload, Hourglass, MapPinOff, WifiOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { formatTime } from "@/lib/format";
import type { DeviceState, Kiosk } from "./use-kiosks";

export function DeviceStateBadge({ kiosk }: { kiosk: Kiosk }) {
  const { t } = useTranslation();
  // An old server sends no state: an active device is then shown as online.
  const state: DeviceState = kiosk.state ?? (kiosk.status === "active" ? "online" : kiosk.status);
  switch (state) {
    case "online":
      return (
        <Badge tone="success">
          <CircleCheck aria-hidden />
          {t("kiosks.state.online")}
        </Badge>
      );
    case "offline":
      return (
        <Badge tone="danger">
          <WifiOff aria-hidden />
          {kiosk.last_contact_at
            ? t("kiosks.state.offlineSince", { time: formatTime(kiosk.last_contact_at) })
            : t("kiosks.state.offline")}
        </Badge>
      );
    case "needs_location":
      return (
        <Badge tone="warning">
          <MapPinOff aria-hidden />
          {t("kiosks.state.needsLocation")}
        </Badge>
      );
    case "sending":
      return (
        <Badge tone="primary">
          <CloudUpload aria-hidden />
          {t("kiosks.state.sending", { count: kiosk.queue?.count ?? 0 })}
        </Badge>
      );
    case "revoked":
      return (
        <Badge tone="neutral">
          <Ban aria-hidden />
          {t("kiosks.state.revoked")}
        </Badge>
      );
    default:
      return (
        <Badge tone="warning">
          <Hourglass aria-hidden />
          {t("kiosks.state.pending")}
        </Badge>
      );
  }
}
