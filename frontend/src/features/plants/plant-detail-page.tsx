// One plant: header, readiness card ("ready for attendance?") and tabs for geofence,
// departments, shifts and categories. Only the Super Admin can change setup; others read.
import { Check, Circle, MapPin, Pencil, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { describeError } from "@/features/auth/error-message";
import { useMe } from "@/features/auth/use-auth";
import { PlantKiosksTab } from "@/features/kiosks/plant-kiosks-tab";
import { cn } from "@/lib/utils";
import { EditPlantDialog } from "./add-plant-dialog";
import { GatePosterButton } from "./gate-poster-button";
import { GeofenceTab } from "./geofence-tab";
import { NamedItemsTab } from "./named-items-tab";
import { PlantRulesCard } from "./plant-rules-card";
import { PlantStatusDialog } from "./plant-status-dialog";
import { PlantActiveBadge } from "./plants-page";
import { ShiftsTab } from "./shifts-tab";
import { type Readiness, usePlant, useReadiness } from "./use-plants";

type CheckState = "done" | "missing" | "none";

function CheckRow({ state, title, detail }: { state: CheckState; title: string; detail: string }) {
  const { t } = useTranslation();
  const Icon = state === "done" ? Check : state === "missing" ? X : Circle;
  return (
    <li className="flex items-start gap-3 py-3">
      <span
        className={cn(
          "mt-0.5 grid size-7 shrink-0 place-items-center rounded-full",
          state === "done" && "bg-success-soft text-success",
          state === "missing" && "bg-destructive-soft text-destructive",
          state === "none" && "bg-muted text-muted-foreground",
        )}
      >
        <Icon className="size-4" aria-hidden />
        {/* Never colour alone: the word is read by screen readers. */}
        <span className="sr-only">{t(`plants.readiness.state.${state}`)}</span>
      </span>
      <span>
        <span className="block text-sm font-bold">{title}</span>
        <span className="block text-[13px] text-muted-foreground">{detail}</span>
      </span>
    </li>
  );
}

const DEVICE_LINES = new Set(["deviceOnline", "locationGood"]);

export function ReadinessCard({ readiness }: { readiness: Readiness }) {
  const { t } = useTranslation();
  const checks: { key: string; state: CheckState; detail: string }[] = [
    {
      key: "geofence",
      state: readiness.geofence ? "done" : "missing",
      detail: t(readiness.geofence ? "plants.readiness.geofenceOk" : "plants.readiness.geofenceNo"),
    },
    {
      key: "shifts",
      state: readiness.active_shifts > 0 ? "done" : "missing",
      detail: t("plants.readiness.shiftsCount", { count: readiness.active_shifts }),
    },
    {
      key: "categories",
      state: readiness.active_categories > 0 ? "done" : "missing",
      detail: t("plants.readiness.categoriesCount", { count: readiness.active_categories }),
    },
    {
      key: "kiosk",
      state: readiness.active_kiosks > 0 ? "done" : "missing",
      detail:
        readiness.active_kiosks > 0
          ? t("plants.readiness.kioskCount", { count: readiness.active_kiosks })
          : t("plants.readiness.kioskNo"),
    },
    // M4: lines from the gate device's heartbeat; only shown once the plant has a device.
    ...(readiness.active_kiosks > 0
      ? [
          {
            key: "deviceOnline",
            state: (readiness.device_online ? "done" : "missing") as CheckState,
            detail: t(
              readiness.device_online
                ? "plants.readiness.deviceOnlineYes"
                : "plants.readiness.deviceOnlineNo",
            ),
          },
          {
            key: "locationGood",
            state: (readiness.location_good ? "done" : "missing") as CheckState,
            detail: t(
              readiness.location_good
                ? "plants.readiness.locationGoodYes"
                : "plants.readiness.locationGoodNo",
            ),
          },
        ]
      : []),
    {
      key: "employees",
      state: readiness.active_employees > 0 ? "done" : "none",
      detail: t("plants.readiness.employeesCount", { count: readiness.active_employees }),
    },
  ];
  // The two device lines are information only: they never count towards "ready for attendance".
  const required = checks.filter((check) => !DEVICE_LINES.has(check.key));
  const doneCount = required.filter((check) => check.state === "done").length;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>{t("plants.readiness.title")}</CardTitle>
          <CardDescription>{t("plants.readiness.description")}</CardDescription>
        </div>
        {readiness.ready ? (
          <Badge tone="success">
            <Check aria-hidden />
            {t("plants.readiness.ready")}
          </Badge>
        ) : (
          <Badge tone="warning">
            {t("plants.readiness.notReady", { count: required.length - doneCount })}
          </Badge>
        )}
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {checks.map((check) => (
            <CheckRow
              key={check.key}
              state={check.state}
              title={t(`plants.readiness.check.${check.key}`)}
              detail={check.detail}
            />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export function PlantDetailPage() {
  const { t } = useTranslation();
  const { plantId = "" } = useParams();
  const me = useMe();
  const canEdit = me.data?.role === "super_admin";
  const canKioskManage = canEdit || me.data?.role === "plant_head";
  const plant = usePlant(plantId);
  const readiness = useReadiness(plantId);
  const [tab, setTab] = useState("overview");
  const [editing, setEditing] = useState(false);
  const [changingStatus, setChangingStatus] = useState(false);

  if (plant.isError) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <Alert tone="danger">
          <span>{describeError(plant.error, t)}</span>
        </Alert>
        <Link to="/admin/plants" className="text-sm font-semibold text-primary underline">
          {t("plants.backToList")}
        </Link>
      </div>
    );
  }
  if (plant.isPending) {
    return <Skeleton className="mx-auto h-40 max-w-6xl" />;
  }
  const data = plant.data;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <nav aria-label={t("common.breadcrumb")} className="text-[13px] text-muted-foreground">
        <Link to="/admin/plants" className="hover:underline">
          {t("plants.title")}
        </Link>
        <span aria-hidden> › </span>
        <span>{data.code}</span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-4">
          <span className="code grid size-14 shrink-0 place-items-center rounded-lg bg-primary text-base font-bold text-primary-foreground">
            {data.code}
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">{data.name}</h1>
              <PlantActiveBadge active={data.is_active} />
            </div>
            {data.address ? (
              <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                <MapPin className="size-4" aria-hidden />
                {data.address}
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canKioskManage ? <GatePosterButton plantId={plantId} plantCode={data.code} /> : null}
          {canEdit ? (
            <>
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil aria-hidden />
                {t("plants.editDetails")}
              </Button>
              <Button
                variant={data.is_active ? "danger" : "outline"}
                onClick={() => setChangingStatus(true)}
              >
                {data.is_active ? t("plants.deactivate") : t("plants.reactivate")}
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {!canEdit ? <Alert tone="info">{t("plants.readOnly")}</Alert> : null}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">{t("plants.tabs.overview")}</TabsTrigger>
          <TabsTrigger value="geofence">{t("plants.tabs.geofence")}</TabsTrigger>
          <TabsTrigger value="departments">{t("plants.tabs.departments")}</TabsTrigger>
          <TabsTrigger value="shifts">{t("plants.tabs.shifts")}</TabsTrigger>
          <TabsTrigger value="categories">{t("plants.tabs.categories")}</TabsTrigger>
          <TabsTrigger value="kiosks">{t("plants.tabs.kiosks")}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          {readiness.isError ? (
            <Alert tone="danger">{describeError(readiness.error, t)}</Alert>
          ) : readiness.data ? (
            <div className="space-y-5">
              <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
                <ReadinessCard readiness={readiness.data} />
                <Card>
                  <CardHeader>
                    <CardTitle>{t("plants.details.title")}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <dl className="space-y-3 text-sm">
                      <div>
                        <dt className="text-muted-foreground">{t("plants.columns.code")}</dt>
                        <dd className="code font-bold">{data.code}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">{t("plants.columns.name")}</dt>
                        <dd className="font-semibold">{data.name}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">{t("plants.details.address")}</dt>
                        <dd>{data.address || "–"}</dd>
                      </div>
                    </dl>
                  </CardContent>
                </Card>
              </div>
              <PlantRulesCard plant={data} canEdit={canEdit} />
            </div>
          ) : (
            <Skeleton className="h-64 w-full" />
          )}
        </TabsContent>
        <TabsContent value="geofence">
          <GeofenceTab plantId={plantId} canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="departments">
          <NamedItemsTab plantId={plantId} kind="departments" canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="shifts">
          <ShiftsTab
            plantId={plantId}
            plantCode={data.code}
            plantLabel={`${data.code} · ${data.name}`}
            canEdit={canEdit}
          />
        </TabsContent>
        <TabsContent value="kiosks">
          <PlantKiosksTab plantId={plantId} canManage={canKioskManage} />
        </TabsContent>
        <TabsContent value="categories">
          <NamedItemsTab plantId={plantId} kind="categories" canEdit={canEdit} />
        </TabsContent>
      </Tabs>

      <EditPlantDialog plant={data} open={editing} onOpenChange={setEditing} />
      <PlantStatusDialog plant={data} open={changingStatus} onOpenChange={setChangingStatus} />
    </div>
  );
}
