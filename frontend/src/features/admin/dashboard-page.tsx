// The dashboard. In M1 it is a placeholder; the live headcount arrives in M5.
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useMe } from "@/features/auth/use-auth";
import { HealthStatus } from "@/features/health/health-status";

export function DashboardPage() {
  const { t } = useTranslation();
  const me = useMe();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-[26px] font-bold tracking-tight">
        {t("dashboard.welcome", { name: me.data?.name })}
      </h1>
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
