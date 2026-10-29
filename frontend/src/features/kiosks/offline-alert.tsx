// The offline badge in the top bar (F-36) and the amber alert banner (F-46) (M4 spec §4.7).
// The server decides who gets an alert and when: only the Super Admin and the plant's Plant Head,
// only while one of the plant's shifts is running, only after `kiosk_offline_alert_minutes`.
// "Hide" is a convenience of this browser and ends by itself when the device is back online.
import { TriangleAlert, WifiOff, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { formatTime } from "@/lib/format";
import { type StatusSummary, useStatusSummary } from "./use-kiosks";

const HIDDEN_KEY = "upasthiti.hiddenOfflineAlerts";

function readHidden(): string[] {
  try {
    return JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

function writeHidden(ids: string[]) {
  try {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify(ids));
  } catch {
    // Storage blocked: "Hide" only lasts until the next refresh.
  }
}

/** "⚠ 1 attendance device offline" in the top bar; hidden while every device is online. */
export function OfflineBadge({ summary }: { summary: StatusSummary | undefined }) {
  const { t } = useTranslation();
  const count = summary?.offline ?? 0;
  if (count === 0) return null;
  return (
    <Link
      to="/admin/kiosks?state=offline"
      className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full bg-destructive-soft px-3 text-xs font-bold text-destructive"
    >
      <WifiOff className="size-3.5" aria-hidden />
      <span className="hidden sm:inline">{t("kiosks.offlineBadge", { count })}</span>
      <span className="sm:hidden">{count}</span>
    </Link>
  );
}

export function OfflineAlertBanner({ summary }: { summary: StatusSummary | undefined }) {
  const { t } = useTranslation();
  const [hidden, setHidden] = useState<string[]>(readHidden);
  const alerts = summary?.alerts ?? [];

  // A device that is back online is forgotten, so its next outage shows the banner again.
  useEffect(() => {
    if (!summary) return;
    const stillOffline = new Set(summary.alerts.map((alert) => alert.kiosk.id));
    const stored = readHidden();
    const kept = stored.filter((id) => stillOffline.has(id));
    if (kept.length !== stored.length) {
      writeHidden(kept);
      setHidden(kept);
    }
  }, [summary]);

  const visible = alerts.filter((alert) => !hidden.includes(alert.kiosk.id));
  if (visible.length === 0) return null;
  return (
    <div className="space-y-2 px-4 pt-4 sm:px-5 lg:px-8">
      {visible.map((alert) => {
        const minutes = Math.max(
          1,
          Math.round((Date.now() - new Date(alert.offline_since).getTime()) / 60_000),
        );
        return (
          <div
            key={alert.kiosk.id}
            role="alert"
            className="flex flex-wrap items-center gap-3 rounded-lg border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-warning"
          >
            <TriangleAlert className="size-4 shrink-0" aria-hidden />
            <p className="min-w-0 flex-1 font-semibold">
              {t("kiosks.offlineAlert", {
                name: alert.kiosk.name,
                time: formatTime(alert.offline_since),
                minutes,
              })}
            </p>
            <Link
              to="/admin/kiosks?state=offline"
              className="inline-flex min-h-9 items-center rounded-md border border-border-strong bg-card px-3 text-sm font-semibold text-foreground hover:bg-muted"
            >
              {t("kiosks.offlineAlertView")}
            </Link>
            <Button
              size="sm"
              variant="ghost"
              aria-label={t("kiosks.offlineAlertHide")}
              onClick={() => {
                const next = [...hidden, alert.kiosk.id];
                writeHidden(next);
                setHidden(next);
              }}
            >
              <X className="size-4" aria-hidden />
              {t("kiosks.offlineAlertHide")}
            </Button>
          </div>
        );
      })}
    </div>
  );
}

/** One query for the badge, the sidebar count and the banner. */
export function useOfflineSummary() {
  return useStatusSummary().data;
}
