// The dashboard card "Face enrolment" (spec M3 §4.13, F-40, design gate C): how many people who
// punch with their face are enrolled, one bar per plant, and the people who should enrol again.
// All three roles see it; the server limits the numbers to the plants the user may see. The face
// engine state (from /health) is shown when the engine is not ready.
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ScanFace, TriangleAlert, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet } from "@/lib/api-client";
import { type EnrolmentProgress, useEnrolmentProgress } from "./use-face";

type FaceEngineHealth = { face?: { state: "loading" | "ready" | "off" | "failed" } };

// The engine state is not personal data and needs no login (it is part of /health).
function useFaceEngineState() {
  return useQuery({
    queryKey: ["health", "face"],
    queryFn: () => apiGet<FaceEngineHealth>("/health"),
    select: (health) => health.face?.state ?? "ready",
    refetchInterval: 30_000,
  });
}

function percent(enrolled: number, total: number): number {
  return total === 0 ? 0 : Math.round((enrolled / total) * 100);
}

function Meter({ value }: { value: number }) {
  // One measure in one colour; the number beside it carries the value (the bar is a visual aid).
  return (
    <div className="h-2 overflow-hidden rounded-full bg-border" aria-hidden>
      <div className="h-full rounded-full bg-primary" style={{ width: `${value}%` }} />
    </div>
  );
}

function EngineNotice() {
  const { t } = useTranslation();
  const state = useFaceEngineState().data;
  if (state === "loading") {
    return (
      <Alert tone="info" className="mb-4">
        <span>{t("dashboard.face.engine.starting")}</span>
      </Alert>
    );
  }
  if (state === "failed" || state === "off") {
    return (
      <Alert tone="danger" className="mb-4">
        <span>{t("dashboard.face.engine.failed")}</span>
      </Alert>
    );
  }
  return null;
}

function Numbers({ progress, plantName }: { progress: EnrolmentProgress; plantName?: string }) {
  const { t } = useTranslation();
  const { totals } = progress;
  const share = percent(totals.enrolled, totals.face_employees);
  const showPlants = progress.plants.length > 1;
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[34px] leading-none font-extrabold">
            <span className="tnum">{totals.enrolled}</span>{" "}
            <span className="text-lg font-semibold text-muted-foreground">
              {t("dashboard.face.enrolledOf", { total: totals.face_employees })}
            </span>
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("dashboard.face.percent", { percent: share, count: totals.not_enrolled })}
          </p>
        </div>
        {totals.reenrol_suggested > 0 ? (
          <Link
            to="/admin/employees?face_state=reenrol_suggested"
            className="flex items-center gap-3 rounded-xl border bg-card px-4 py-2 hover:bg-muted"
          >
            <TriangleAlert className="size-5 text-warning" aria-hidden />
            <span>
              <span className="tnum block text-lg font-bold">{totals.reenrol_suggested}</span>
              <span className="text-sm text-muted-foreground">{t("dashboard.face.reenrol")}</span>
            </span>
          </Link>
        ) : null}
      </div>
      <div className="mt-4">
        <Meter value={share} />
      </div>

      {showPlants ? (
        <ul
          className="mt-5 divide-y border-t"
          aria-label={plantName ?? t("dashboard.face.perPlant")}
        >
          {progress.plants.map((row) => {
            const rowShare = percent(row.enrolled, row.face_employees);
            return (
              <li
                key={row.plant.id}
                title={`${row.plant.code}: ${row.enrolled} / ${row.face_employees}`}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 py-2.5 sm:grid-cols-[10rem_1fr_9rem]"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold">{row.plant.code}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {row.plant.name}
                  </span>
                </span>
                <span className="col-span-2 row-start-2 sm:col-span-1 sm:row-start-auto">
                  <Meter value={rowShare} />
                </span>
                <span className="text-right text-sm">
                  <span className="tnum font-bold">{row.enrolled}</span>{" "}
                  <span className="text-muted-foreground">
                    {t("dashboard.face.plantCount", { total: row.face_employees })}
                  </span>
                  <span className="tnum block text-xs text-muted-foreground">
                    {rowShare}%
                    {row.reenrol_suggested > 0
                      ? ` · ${t("dashboard.face.plantReenrol", { count: row.reenrol_suggested })}`
                      : ""}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </>
  );
}

export function FaceEnrolmentCard() {
  const { t } = useTranslation();
  const progress = useEnrolmentProgress();
  const data = progress.data;
  const single = data !== undefined && data.plants.length === 1 ? data.plants[0] : undefined;
  const title = single
    ? t("dashboard.face.titleAt", { plant: single.plant.code })
    : t("dashboard.face.title");

  return (
    <Card>
      <CardHeader className="flex-row items-center gap-3">
        <span className="grid size-10 place-items-center rounded-full bg-primary-soft text-primary">
          <ScanFace className="size-5" aria-hidden />
        </span>
        <div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{t("dashboard.face.description")}</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <EngineNotice />
        {progress.isPending ? <Skeleton className="h-28 w-full" /> : null}
        {progress.isError ? (
          <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
            <span>{t("dashboard.face.error")}</span>
            <Button size="sm" variant="outline" onClick={() => progress.refetch()}>
              {t("dashboard.face.retry")}
            </Button>
          </div>
        ) : null}
        {data ? <Numbers progress={data} /> : null}
        {data && data.totals.enrolled === 0 ? (
          <div className="mt-4 rounded-lg border-2 border-dashed p-4 text-sm">
            <p className="font-bold">{t("dashboard.face.empty.title")}</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
              <li>{t("dashboard.face.empty.step1")}</li>
              <li>{t("dashboard.face.empty.step2")}</li>
              <li>{t("dashboard.face.empty.step3")}</li>
            </ol>
          </div>
        ) : null}
        {data ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-3">
            <span className="text-xs text-muted-foreground">{t("dashboard.face.updated")}</span>
            {data.totals.not_enrolled > 0 ? (
              <Link
                to="/admin/employees?face_state=not_enrolled"
                className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold underline hover:bg-muted"
              >
                <Users className="size-4" aria-hidden />
                {t("dashboard.face.seeNotEnrolled", { count: data.totals.not_enrolled })}
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
