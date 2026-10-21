// Gate notices (/admin/notices, spec M2 §4.11, design gate C): short messages shown on the gate
// kiosk screen of one plant or of every plant. The Super Admin writes for any plant or all
// plants; a Plant Head only for their own plant and cannot change an all-plants notice; the
// Corporate Head reads. Nothing is deleted: "End now" stops a notice and it stays in the list.
import {
  Ban,
  CalendarClock,
  Globe2,
  Info,
  Megaphone,
  Pencil,
  Plus,
  Radio,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { usePlantFilter } from "@/app/layouts/plant-filter";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
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
import { usePlants } from "@/features/plants/use-plants";
import { formatDate, formatNumber, formatTime } from "@/lib/format";
import { NoticeFormDialog } from "./notice-form-dialog";
import { type Notice, type NoticeState, useEndNotice, useNotices } from "./use-notices";

const PAGE_SIZE = 50;
const STATES: NoticeState[] = ["showing", "scheduled", "ended"];

function StateBadge({ state }: { state: NoticeState }) {
  const { t } = useTranslation();
  if (state === "showing") {
    return (
      <Badge tone="success">
        <Radio aria-hidden />
        {t("notices.state.showing")}
      </Badge>
    );
  }
  if (state === "scheduled") {
    return (
      <Badge tone="primary">
        <CalendarClock aria-hidden />
        {t("notices.state.scheduled")}
      </Badge>
    );
  }
  return (
    <Badge tone="neutral">
      <Ban aria-hidden />
      {t("notices.state.ended")}
    </Badge>
  );
}

function When({ moment }: { moment: string }) {
  return (
    <span className="tnum block">
      <span className="block">{formatDate(moment)}</span>
      <span className="text-xs text-muted-foreground">{formatTime(moment)}</span>
    </span>
  );
}

function EndNoticeDialog({ notice, onClose }: { notice: Notice; onClose: () => void }) {
  const { t } = useTranslation();
  const end = useEndNotice();
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent role="alertdialog">
        <DialogTitle>{t("notices.end.title")}</DialogTitle>
        <DialogDescription>{t("notices.end.explain")}</DialogDescription>
        <blockquote className="mt-3 rounded-md border-l-4 border-border-strong bg-muted p-3 text-sm">
          {notice.text}
        </blockquote>
        {end.isError ? (
          <Alert tone="danger" className="mt-3">
            <span>{describeError(end.error, t)}</span>
          </Alert>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="danger"
            disabled={end.isPending}
            onClick={() => end.mutate(notice.id, { onSuccess: onClose })}
          >
            <Ban aria-hidden />
            {t("notices.end.confirm")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function NoticesPage() {
  const { t } = useTranslation();
  const me = useMe();
  const role = me.data?.role;
  const canWrite = role === "super_admin" || role === "plant_head";
  const { plantId } = usePlantFilter();
  const plants = usePlants({ is_active: true });

  const [state, setState] = useState<"" | NoticeState>("");
  const [scope, setScope] = useState<"" | "all_plants">("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Notice | "new" | null>(null);
  const [ending, setEnding] = useState<Notice | null>(null);

  const notices = useNotices({
    plant_id: plantId || undefined,
    all_plants: scope === "all_plants" || undefined,
    state: state || undefined,
    page,
    page_size: PAGE_SIZE,
  });
  const rows = notices.data?.items ?? [];
  const total = notices.data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const plantItems = plants.data?.items ?? [];
  // A Plant Head's own plant (the top-bar filter is fixed to it for them).
  const fixedPlantId = role === "plant_head" ? (me.data?.plant_ids[0] ?? plantId) || null : null;
  const formPlants =
    fixedPlantId === null ? plantItems : plantItems.filter((plant) => plant.id === fixedPlantId);
  const filtered = Boolean(state || scope);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("notices.title")}</h1>
          <p className="text-muted-foreground">{t("notices.description")}</p>
        </div>
        {canWrite ? (
          <Button onClick={() => setEditing("new")}>
            <Plus aria-hidden />
            {t("notices.new")}
          </Button>
        ) : null}
      </header>

      {role === "corporate_head" ? (
        <Alert tone="info">
          <Info aria-hidden />
          <span>{t("notices.readOnlyCorporateHead")}</span>
        </Alert>
      ) : null}
      {role === "plant_head" ? (
        <Alert tone="info">
          <Info aria-hidden />
          <span>{t("notices.plantHeadNote")}</span>
        </Alert>
      ) : null}

      <Card className="overflow-hidden p-0">
        <div className="flex flex-wrap items-center gap-2 border-b p-4">
          <Select
            aria-label={t("notices.filter.state")}
            value={state}
            onChange={(event) => {
              setState(event.target.value as typeof state);
              setPage(1);
            }}
            className="w-auto"
          >
            <option value="">{t("notices.filter.anyState")}</option>
            {STATES.map((value) => (
              <option key={value} value={value}>
                {t(`notices.state.${value}`)}
              </option>
            ))}
          </Select>
          <Button
            size="sm"
            variant={scope === "all_plants" ? "primary" : "outline"}
            aria-pressed={scope === "all_plants"}
            onClick={() => {
              setScope(scope === "all_plants" ? "" : "all_plants");
              setPage(1);
            }}
          >
            <Globe2 aria-hidden />
            {t("notices.filter.allPlantsOnly")}
          </Button>
          <span className="ml-auto text-sm text-muted-foreground">
            {t("notices.count", { formatted: formatNumber(total), count: total })}
          </span>
        </div>

        {notices.isError ? (
          <Alert tone="danger" className="m-4">
            <span>{describeError(notices.error, t)}</span>
            <Button
              size="sm"
              variant="outline"
              className="ml-auto"
              onClick={() => notices.refetch()}
            >
              {t("common.tryAgain")}
            </Button>
          </Alert>
        ) : null}

        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>{t("notices.columns.text")}</TableHead>
              <TableHead>{t("notices.columns.plant")}</TableHead>
              <TableHead>{t("notices.columns.level")}</TableHead>
              <TableHead>{t("notices.columns.starts")}</TableHead>
              <TableHead>{t("notices.columns.ends")}</TableHead>
              <TableHead>{t("notices.columns.state")}</TableHead>
              <TableHead>{t("notices.columns.createdBy")}</TableHead>
              <TableHead>
                <span className="sr-only">{t("common.actions")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {notices.isPending
              ? Array.from({ length: 4 }, (_, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: fixed placeholder rows
                  <TableRow key={index}>
                    <TableCell colSpan={8}>
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              : rows.map((notice) => (
                  <TableRow key={notice.id}>
                    <TableCell className="max-w-80 break-words whitespace-normal">
                      {notice.text}
                    </TableCell>
                    <TableCell>
                      {notice.plant ? (
                        <span className="code font-bold">{notice.plant.code}</span>
                      ) : (
                        <Badge tone="primary">
                          <Globe2 aria-hidden />
                          {t("notices.allPlants")}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {notice.level === "important" ? (
                        <Badge tone="warning">
                          <TriangleAlert aria-hidden />
                          {t("notices.level.important")}
                        </Badge>
                      ) : (
                        <Badge tone="neutral">
                          <Megaphone aria-hidden />
                          {t("notices.level.normal")}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <When moment={notice.starts_at} />
                    </TableCell>
                    <TableCell>
                      <When moment={notice.ended_at ?? notice.ends_at} />
                    </TableCell>
                    <TableCell>
                      <StateBadge state={notice.state} />
                    </TableCell>
                    <TableCell className="text-sm">
                      {notice.created_by.name}
                      {notice.ended_by ? (
                        <span className="block text-xs text-muted-foreground">
                          {t("notices.endedBy", { name: notice.ended_by.name })}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {notice.can_change && notice.state !== "ended" ? (
                        <span className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => setEditing(notice)}>
                            <Pencil aria-hidden />
                            {t("notices.edit")}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEnding(notice)}>
                            <Ban aria-hidden />
                            {t("notices.endNow")}
                          </Button>
                        </span>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
            {!notices.isPending && rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                  {filtered ? t("notices.noMatch") : t("notices.empty")}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>

        {lastPage > 1 ? (
          <div className="flex items-center justify-end gap-2 border-t px-4 py-3 text-sm">
            <Button
              size="sm"
              variant="outline"
              disabled={page <= 1}
              aria-label={t("employees.previousPage")}
              onClick={() => setPage(page - 1)}
            >
              ‹
            </Button>
            <span className="tnum">{t("employees.pageOf", { page, pages: lastPage })}</span>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= lastPage}
              aria-label={t("employees.nextPage")}
              onClick={() => setPage(page + 1)}
            >
              ›
            </Button>
          </div>
        ) : null}
      </Card>

      {editing ? (
        <NoticeFormDialog
          notice={editing === "new" ? null : editing}
          plants={formPlants}
          fixedPlantId={fixedPlantId}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {ending ? <EndNoticeDialog notice={ending} onClose={() => setEnding(null)} /> : null}
    </div>
  );
}
