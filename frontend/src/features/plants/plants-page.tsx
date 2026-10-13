// Plants page: summary numbers, the list of plants with geofence/kiosk/employee counts, and
// (Super Admin) adding plants – one by one or the client's 7 plants in one click.
import {
  Ban,
  ChevronRight,
  CircleCheck,
  CircleX,
  Factory,
  MapPinned,
  Plus,
  Tablet,
  Users,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { describeError } from "@/features/auth/error-message";
import { useMe } from "@/features/auth/use-auth";
import { formatNumber } from "@/lib/format";
import { AddPlantDialog } from "./add-plant-dialog";
import { type Plant, useAddClientPlants, usePlants } from "./use-plants";

type StatusFilter = "active" | "inactive" | "all";

export function PlantActiveBadge({ active }: { active: boolean }) {
  const { t } = useTranslation();
  return active ? (
    <Badge tone="success">
      <CircleCheck aria-hidden />
      {t("plants.status.active")}
    </Badge>
  ) : (
    <Badge tone="neutral">
      <Ban aria-hidden />
      {t("plants.status.inactive")}
    </Badge>
  );
}

export function GeofenceBadge({ set }: { set: boolean }) {
  const { t } = useTranslation();
  return set ? (
    <Badge tone="success">
      <CircleCheck aria-hidden />
      {t("plants.geofence.set")}
    </Badge>
  ) : (
    <Badge tone="danger">
      <CircleX aria-hidden />
      {t("plants.geofence.notSet")}
    </Badge>
  );
}

function SummaryTile({
  icon: Icon,
  value,
  label,
}: {
  icon: typeof Factory;
  value: string;
  label: string;
}) {
  return (
    <Card className="flex items-center gap-4 p-4">
      <span className="grid size-10 shrink-0 place-items-center rounded-md bg-primary-soft text-primary-soft-foreground">
        <Icon className="size-5" aria-hidden />
      </span>
      <span>
        <span className="tnum block text-2xl font-bold">{value}</span>
        <span className="block text-[13px] text-muted-foreground">{label}</span>
      </span>
    </Card>
  );
}

function Summary({ plants }: { plants: Plant[] }) {
  const { t } = useTranslation();
  const active = plants.filter((plant) => plant.is_active);
  const withGeofence = active.filter((plant) => plant.geofence_set).length;
  const kiosks = active.reduce((sum, plant) => sum + plant.active_kiosks, 0);
  const employees = active.reduce((sum, plant) => sum + plant.active_employees, 0);
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <SummaryTile
        icon={Factory}
        value={formatNumber(active.length)}
        label={t("plants.summary.active")}
      />
      <SummaryTile
        icon={MapPinned}
        value={t("plants.summary.ofTotal", { count: withGeofence, total: active.length })}
        label={t("plants.summary.geofence")}
      />
      <SummaryTile icon={Tablet} value={formatNumber(kiosks)} label={t("plants.summary.kiosks")} />
      <SummaryTile
        icon={Users}
        value={formatNumber(employees)}
        label={t("plants.summary.employees")}
      />
    </div>
  );
}

function EmptyState({ canManage, onAddOne }: { canManage: boolean; onAddOne: () => void }) {
  const { t } = useTranslation();
  const addClientPlants = useAddClientPlants();
  return (
    <Card className="p-10 text-center">
      <Factory className="mx-auto size-10 text-muted-foreground" aria-hidden />
      <h2 className="mt-3 text-lg font-bold">{t("plants.empty.title")}</h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
        {canManage ? t("plants.empty.textAdmin") : t("plants.empty.textReader")}
      </p>
      {addClientPlants.isError ? (
        <Alert tone="danger" className="mx-auto mt-4 max-w-md text-left">
          <span>{describeError(addClientPlants.error, t)}</span>
        </Alert>
      ) : null}
      {canManage ? (
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Button disabled={addClientPlants.isPending} onClick={() => addClientPlants.mutate()}>
            <Factory aria-hidden />
            {t("plants.empty.addClientPlants")}
          </Button>
          <Button variant="outline" onClick={onAddOne}>
            <Plus aria-hidden />
            {t("plants.add")}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

export function PlantsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const me = useMe();
  const canManage = me.data?.role === "super_admin";
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("active");
  const [adding, setAdding] = useState(false);
  // One request for all plants (there are few); filtering happens here so the summary
  // numbers stay the same whatever filter is chosen.
  const plants = usePlants();

  const allPlants = plants.data?.items ?? [];
  const needle = search.trim().toLowerCase();
  const shown = allPlants.filter(
    (plant) =>
      (status === "all" || plant.is_active === (status === "active")) &&
      (!needle ||
        plant.code.toLowerCase().includes(needle) ||
        plant.name.toLowerCase().includes(needle)),
  );

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">{t("plants.title")}</h1>
          <p className="max-w-xl text-sm text-muted-foreground">{t("plants.subtitle")}</p>
        </div>
        {canManage && allPlants.length > 0 ? (
          <Button onClick={() => setAdding(true)}>
            <Plus aria-hidden />
            {t("plants.add")}
          </Button>
        ) : null}
      </div>

      {plants.isError ? (
        <Alert tone="danger">
          <span>{describeError(plants.error, t)}</span>
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => plants.refetch()}>
            {t("common.tryAgain")}
          </Button>
        </Alert>
      ) : null}

      {plants.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : plants.isSuccess && allPlants.length === 0 ? (
        <EmptyState canManage={canManage} onAddOne={() => setAdding(true)} />
      ) : plants.isSuccess ? (
        <>
          <Summary plants={allPlants} />
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-3 border-b p-4">
              <Input
                type="search"
                placeholder={t("plants.searchPlaceholder")}
                aria-label={t("plants.searchPlaceholder")}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="max-w-xs"
              />
              <Select
                aria-label={t("plants.statusFilter")}
                value={status}
                onChange={(event) => setStatus(event.target.value as StatusFilter)}
                className="w-auto"
              >
                <option value="active">{t("plants.filter.active")}</option>
                <option value="inactive">{t("plants.filter.inactive")}</option>
                <option value="all">{t("plants.filter.all")}</option>
              </Select>
              <span className="ml-auto text-[13px] text-muted-foreground">
                {t("plants.shownCount", { count: shown.length })}
              </span>
            </div>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>{t("plants.columns.code")}</TableHead>
                  <TableHead>{t("plants.columns.name")}</TableHead>
                  <TableHead>{t("plants.columns.status")}</TableHead>
                  <TableHead>{t("plants.columns.geofence")}</TableHead>
                  <TableHead>{t("plants.columns.kiosks")}</TableHead>
                  <TableHead className="text-right">{t("plants.columns.employees")}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t("common.actions")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((plant) => (
                  <TableRow
                    key={plant.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/admin/plants/${plant.id}`)}
                  >
                    <TableCell className="code font-bold">{plant.code}</TableCell>
                    <TableCell>
                      <Link
                        to={`/admin/plants/${plant.id}`}
                        className="block font-semibold hover:underline"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {plant.name}
                      </Link>
                      {plant.address ? (
                        <span className="block text-xs text-muted-foreground">{plant.address}</span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <PlantActiveBadge active={plant.is_active} />
                    </TableCell>
                    <TableCell>
                      <GeofenceBadge set={plant.geofence_set} />
                    </TableCell>
                    <TableCell className="text-sm">
                      {plant.active_kiosks > 0
                        ? t("plants.kioskCount", { count: plant.active_kiosks })
                        : t("plants.noKiosk")}
                    </TableCell>
                    <TableCell className="tnum text-right font-semibold">
                      {formatNumber(plant.active_employees)}
                    </TableCell>
                    <TableCell>
                      <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {shown.length === 0 ? (
              <p className="p-8 text-center text-muted-foreground">{t("plants.noMatch")}</p>
            ) : null}
          </Card>
        </>
      ) : null}

      <AddPlantDialog
        open={adding}
        onOpenChange={setAdding}
        onCreated={(plant) => navigate(`/admin/plants/${plant.id}`)}
      />
    </div>
  );
}
