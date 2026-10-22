// The dashboard. In M1 it is a placeholder; the live headcount arrives in M5.
import { CalendarClock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useMe } from "@/features/auth/use-auth";
import { HealthStatus } from "@/features/health/health-status";
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

export function DashboardPage() {
  const { t } = useTranslation();
  const me = useMe();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-[26px] font-bold tracking-tight">
        {t("dashboard.welcome", { name: me.data?.name })}
      </h1>
      {me.data?.role === "super_admin" ? <CardsEndingSoon /> : null}
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
