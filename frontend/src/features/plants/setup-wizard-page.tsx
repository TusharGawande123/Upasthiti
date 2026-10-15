// Setup wizard: the five things to do before the first attendance, in order. Each step shows
// done / not done (icon + word) and links to the screen where it is done. The geofence step
// lists the plants that still have no geofence, because every plant needs its own.
import { Check, Circle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { describeError } from "@/features/auth/error-message";
import { cn } from "@/lib/utils";
import { type SetupStepKey, usePlants, useSetupStatus } from "./use-plants";

// Where each step is done. Employees and kiosks have their own pages in later slices.
const STEP_LINKS: Record<SetupStepKey, string> = {
  plants: "/admin/plants",
  geofence: "/admin/plants",
  shifts_and_categories: "/admin/plants",
  kiosk: "/admin/plants",
  employees: "/admin/plants",
};

export function SetupWizardPage() {
  const { t } = useTranslation();
  const status = useSetupStatus();
  const plants = usePlants({ is_active: true });

  if (status.isPending) return <Skeleton className="mx-auto h-64 max-w-3xl" />;
  if (status.isError) {
    return (
      <Alert tone="danger" className="mx-auto max-w-3xl">
        <span>{describeError(status.error, t)}</span>
        <Button size="sm" variant="outline" className="ml-auto" onClick={() => status.refetch()}>
          {t("common.tryAgain")}
        </Button>
      </Alert>
    );
  }

  const steps = status.data.steps;
  const doneCount = steps.filter((step) => step.done).length;
  const withoutGeofence = plants.data?.items.filter((plant) => !plant.geofence_set) ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-[26px] font-bold tracking-tight">{t("setup.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("setup.subtitle")}</p>
      </div>

      {doneCount === steps.length ? (
        <Alert tone="info">
          <Check aria-hidden />
          <span>{t("setup.allDone")}</span>
        </Alert>
      ) : (
        <p className="tnum text-sm font-semibold">
          {t("setup.progress", { done: doneCount, total: steps.length })}
        </p>
      )}

      <Card>
        <ol className="divide-y">
          {steps.map((step, index) => (
            <li key={step.key} className="flex items-start gap-4 p-5">
              <span
                className={cn(
                  "grid size-9 shrink-0 place-items-center rounded-full text-sm font-bold",
                  step.done ? "bg-success-soft text-success" : "bg-muted text-muted-foreground",
                )}
              >
                {step.done ? (
                  <Check className="size-5" aria-hidden />
                ) : (
                  <Circle className="size-4" aria-hidden />
                )}
                <span className="sr-only">{t(step.done ? "setup.done" : "setup.todo")}</span>
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-bold">
                    {index + 1}. {t(`setup.steps.${step.key}.title`)}
                  </h2>
                  <Badge tone={step.done ? "success" : "neutral"}>
                    {t(step.done ? "setup.done" : "setup.todo")}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t(`setup.steps.${step.key}.text`)}
                </p>
                {step.key === "geofence" && withoutGeofence.length > 0 ? (
                  <ul className="mt-3 space-y-1.5 text-sm">
                    {withoutGeofence.map((plant) => (
                      <li key={plant.id} className="flex items-center gap-2">
                        <span className="code font-bold">{plant.code}</span>
                        <span className="text-muted-foreground">{plant.name}</span>
                        <Link
                          to={`/admin/plants/${plant.id}`}
                          className="ml-auto font-semibold text-primary underline"
                        >
                          {t("setup.drawGeofence")}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              {!step.done ? (
                <Link
                  to={STEP_LINKS[step.key]}
                  className="inline-flex h-8 items-center rounded-lg border border-border-strong bg-card px-3 text-[13px] font-semibold shadow-xs hover:bg-muted"
                >
                  {t("setup.open")}
                </Link>
              ) : null}
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
