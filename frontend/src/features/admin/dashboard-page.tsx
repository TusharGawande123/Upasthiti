// The dashboard. In M1 it is a placeholder; the live headcount arrives in M5.
import { CalendarClock, Tablet } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useMe } from "@/features/auth/use-auth";
import { FaceEnrolmentCard } from "@/features/face/enrolment-card";
import { HealthStatus } from "@/features/health/health-status";
import { useStatusSummary } from "@/features/kiosks/use-kiosks";
import { useExpiringCount } from "@/features/qr-cards/use-qr-cards";

// F-33: how many QR cards end soon, with a link to exactly those cards. Super Admin only,
// because only the Super Admin extends or ends cards (by hand).
function CardsEndingSoon() {
  const { t } = useTranslation();
  const expiring = useExpiringCount(true);
  const count = expiring.data?.count ?? 0;
  const days = expiring.data?.days ?? 14;
  return (
    <Card>
      <CardHeader className="flex-row items-center gap-3">
        <span className="grid size-10 place-items-center rounded-full bg-warning-soft text-warning">
          <CalendarClock className="size-5" aria-hidden />
        </span>
        <div>
          <CardTitle>{t("dashboard.cardsEndingSoon.title")}</CardTitle>
          <CardDescription>
            {expiring.isError
              ? t("dashboard.cardsEndingSoon.error")
              : t("dashboard.cardsEndingSoon.text", { count, days })}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex items-center justify-between">
        <span className="tnum text-4xl font-bold">{expiring.data ? count : "–"}</span>
        <Link
          to="/admin/qr-cards?state=expiring"
          className="text-sm font-semibold text-primary underline"
        >
          {t("dashboard.cardsEndingSoon.link")}
        </Link>
      </CardContent>
    </Card>
  );
}

// M4: how many attendance devices work right now, with a link to the ones that do not (every
// role, in the plants they may see).
function DevicesCard() {
  const { t } = useTranslation();
  const summary = useStatusSummary();
  const data = summary.data;
  return (
    <Card>
      <CardHeader className="flex-row items-center gap-3">
        <span className="grid size-10 place-items-center rounded-full bg-primary-soft text-primary-soft-foreground">
          <Tablet className="size-5" aria-hidden />
        </span>
        <div>
          <CardTitle>{t("dashboard.devices.title")}</CardTitle>
          <CardDescription>
            {summary.isError
              ? t("dashboard.devices.error")
              : data
                ? t("dashboard.devices.text", {
                    online: data.online + data.sending,
                    offline: data.offline,
                    needsLocation: data.needs_location,
                  })
                : t("dashboard.devices.loading")}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex items-center justify-between">
        <span className="tnum text-4xl font-bold">{data ? data.offline : "–"}</span>
        <Link
          to={data && data.offline > 0 ? "/admin/kiosks?state=offline" : "/admin/kiosks"}
          className="text-sm font-semibold text-primary underline"
        >
          {t("dashboard.devices.link")}
        </Link>
      </CardContent>
    </Card>
  );
}

export function DashboardPage() {
  const { t } = useTranslation();
  const me = useMe();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-[26px] font-bold tracking-tight">
        {t("dashboard.welcome", { name: me.data?.name })}
      </h1>
      {me.data ? <DevicesCard /> : null}
      {me.data?.role === "super_admin" ? <CardsEndingSoon /> : null}
      {me.data ? <FaceEnrolmentCard /> : null}
      <Card>
        <CardHeader>
          <CardTitle>{t("dashboard.placeholderTitle")}</CardTitle>
          <CardDescription>{t("dashboard.placeholderText")}</CardDescription>
        </CardHeader>
        <CardContent>
          <HealthStatus />
        </CardContent>
      </Card>
    </div>
  );
}
