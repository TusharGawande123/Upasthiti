// Shows whether the backend is reachable. Each state uses an icon and words, never colour
// alone, and screen readers hear changes through the live region.
import { CircleCheck, LoaderCircle, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatDate, formatTime } from "../../lib/format";
import { useHealth } from "./use-health";

export function HealthStatus() {
  const { t } = useTranslation();
  const health = useHealth();

  return (
    <div role="status" aria-live="polite" className="flex items-start gap-3 text-base">
      {health.isPending && (
        <>
          <LoaderCircle aria-hidden="true" className="mt-0.5 size-5 animate-spin text-slate-500" />
          <span className="text-slate-700">{t("health.checking")}</span>
        </>
      )}

      {health.isSuccess && (
        <>
          <CircleCheck aria-hidden="true" className="mt-0.5 size-5 text-emerald-700" />
          <span className="flex flex-col">
            <span className="font-medium text-emerald-800">{t("health.connected")}</span>
            <span className="text-sm text-slate-600">
              {t("health.serverTime", {
                date: formatDate(health.data.server_time),
                time: formatTime(health.data.server_time),
              })}
            </span>
          </span>
        </>
      )}

      {health.isError && (
        <>
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-5 text-amber-700" />
          <span className="font-medium text-amber-800">{t("health.unreachable")}</span>
        </>
      )}
    </div>
  );
}
