// The punch log (/admin/punches, spec §4.10, design gate C): every card punch of one day, with the
// day's counts as clickable chips, filters, paging and an Excel export. All three roles read it
// (a Plant Head sees punches at their own plant, set by the server). Only the Super Admin sees
// the dark-photo mark and gets "View photo" and "Compare". Read-only: punches never change.
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  CircleX,
  Columns2,
  Eye,
  FileSpreadsheet,
  Flag,
  Hourglass,
  ImageOff,
  Keyboard,
  LogIn,
  LogOut,
  Moon,
  PanelRight,
  Radio,
  Search,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { usePlantFilter } from "@/app/layouts/plant-filter";
import { Alert } from "@/components/ui/alert";
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
import { useKiosks } from "@/features/kiosks/use-kiosks";
import { addDays } from "@/lib/dates";
import { formatDate, formatNumber, formatTimeWithSeconds, todayIst } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PhotoDialog } from "./photo-dialog";
import {
  DirectionBadge,
  EmployeeCell,
  MethodBadge,
  PhotoStateCell,
  ResultCell,
  useReasonText,
} from "./punch-cells";
import { PunchDetailSheet } from "./punch-detail-sheet";
import {
  downloadPunchExport,
  isToday,
  type PunchDetail,
  type PunchFilters,
  type PunchItem,
  type ReviewState,
  usePunches,
  usePunchSummary,
} from "./use-punches";

const PAGE_SIZE = 50;
// What the day's chips and the reason chips can show.
type Focus =
  | "all"
  | "in"
  | "out"
  | "rejected"
  | "dark"
  | "asked"
  | "noFace"
  | "flagged"
  | "offline";
// The Method filter: any, face, face punches decided by a typed code, or card.
type MethodFilter = "" | "face" | "code" | "qr";

function Chip({
  icon: Icon,
  count,
  label,
  active,
  onClick,
  tone,
}: {
  icon: typeof LogIn;
  count: number;
  label: string;
  active: boolean;
  onClick: () => void;
  tone: "success" | "primary" | "danger" | "neutral" | "warning";
}) {
  const colours = {
    success: "bg-success-soft text-success",
    primary: "bg-primary-soft text-primary-soft-foreground",
    danger: "bg-destructive-soft text-destructive",
    neutral: "bg-muted text-muted-foreground",
    warning: "bg-warning-soft text-warning",
  }[tone];
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex cursor-pointer items-center gap-3 rounded-xl border bg-card px-4 py-2.5 text-left transition hover:bg-muted",
        active && "border-primary ring-2 ring-primary/30",
      )}
    >
      <span className={cn("grid size-9 place-items-center rounded-lg", colours)}>
        <Icon className="size-5" aria-hidden />
      </span>
      <span>
        <span className="tnum block text-xl leading-none font-extrabold">
          {formatNumber(count)}
        </span>
        <span className="text-xs text-muted-foreground">{label}</span>
      </span>
    </button>
  );
}

export function PunchesPage() {
  const { t } = useTranslation();
  const reasonText = useReasonText();
  const me = useMe();
  const role = me.data?.role;
  const isSuperAdmin = role === "super_admin";
  const { plantId } = usePlantFilter();

  const [date, setDate] = useState(todayIst());
  const [search, setSearch] = useState("");
  const [typedSearch, setTypedSearch] = useState("");
  const [result, setResult] = useState<"" | "accepted" | "rejected" | "flagged">("");
  const [offlineOnly, setOfflineOnly] = useState(false);
  const [reviewState, setReviewState] = useState<"" | ReviewState>("");
  const [method, setMethod] = useState<MethodFilter>("");
  const [askedOnly, setAskedOnly] = useState(false);
  const [noFaceOnly, setNoFaceOnly] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [kioskId, setKioskId] = useState("");
  const [reason, setReason] = useState("");
  const [darkOnly, setDarkOnly] = useState(false);
  const [focus, setFocus] = useState<Focus>("all");
  const [page, setPage] = useState(1);
  const [photoFor, setPhotoFor] = useState<{ id: string; compare: boolean } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<unknown>(null);

  // Wait a moment after typing before asking the server.
  useEffect(() => {
    const timer = setTimeout(() => {
      setTypedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // A different plant makes the kiosk filter meaningless.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the plant changes
  useEffect(() => {
    setKioskId("");
    setPage(1);
  }, [plantId]);

  const kiosks = useKiosks({ plant_id: plantId || undefined });
  const filters: PunchFilters = {
    date,
    plant_id: plantId || undefined,
    decision: result || undefined,
    method: method === "face" || method === "code" ? "face" : method || undefined,
    match_mode: method === "code" ? "code" : undefined,
    asked_for_code: askedOnly || undefined,
    no_face_photo: noFaceOnly || undefined,
    was_offline: offlineOnly || undefined,
    review_state: reviewState || undefined,
    kiosk_id: kioskId || undefined,
    reason_code: reason || undefined,
    dark_only: darkOnly || undefined,
    q: typedSearch.trim() || undefined,
    page,
    page_size: PAGE_SIZE,
  };
  const punches = usePunches(filters);
  const summary = usePunchSummary(date, plantId || undefined);

  const rows = punches.data?.items ?? [];
  const total = punches.data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const today = isToday(date);
  const filtered = Boolean(
    typedSearch ||
      result ||
      kioskId ||
      reason ||
      darkOnly ||
      method ||
      askedOnly ||
      noFaceOnly ||
      offlineOnly ||
      reviewState,
  );
  const withPhoto = rows.filter((row) => row.snapshot.state === "stored");

  const apply = (change: () => void) => {
    change();
    setPage(1);
  };

  // The chips are the filters: pressing one shows only those punches, pressing it again clears it.
  const pressChip = (next: Focus) =>
    apply(() => {
      const chosen = focus === next ? "all" : next;
      setFocus(chosen);
      setResult(
        chosen === "rejected" || chosen === "flagged"
          ? chosen
          : chosen === "in" || chosen === "out"
            ? "accepted"
            : "",
      );
      setOfflineOnly(chosen === "offline");
      setDarkOnly(chosen === "dark");
      setAskedOnly(chosen === "asked");
      setNoFaceOnly(chosen === "noFace");
      setReason("");
    });

  const exportDay = async () => {
    setExporting(true);
    setExportError(null);
    try {
      await downloadPunchExport(filters);
    } catch (error) {
      setExportError(error);
    } finally {
      setExporting(false);
    }
  };

  const data = summary.data;
  const reasons = Object.entries(data?.rejected_by_reason ?? {}).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("punches.title")}</h1>
          <p className="text-muted-foreground">
            {plantId && !isSuperAdmin && role === "plant_head"
              ? t("punches.descriptionOwnPlant")
              : t("punches.description")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ImageOff className="size-4" aria-hidden />
            {t("punches.noPhotosInFile")}
          </span>
          <Button variant="outline" onClick={exportDay} disabled={exporting}>
            <FileSpreadsheet aria-hidden />
            {t("punches.export")}
          </Button>
        </div>
      </header>

      {role === "plant_head" ? (
        <Alert tone="info">
          <Eye aria-hidden />
          <span>{t("punches.readOnlyPlantHead")}</span>
        </Alert>
      ) : null}
      {role === "corporate_head" ? (
        <Alert tone="info">
          <Eye aria-hidden />
          <span>{t("punches.readOnlyCorporateHead")}</span>
        </Alert>
      ) : null}
      {exportError ? (
        <Alert tone="danger">
          <span>{describeError(exportError, t)}</span>
        </Alert>
      ) : null}

      <section aria-label={t("punches.summary.label")} className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <Chip
            icon={LogIn}
            tone="success"
            count={data?.accepted_in ?? 0}
            label={t("punches.summary.in")}
            active={focus === "in"}
            onClick={() => pressChip("in")}
          />
          <Chip
            icon={LogOut}
            tone="primary"
            count={data?.accepted_out ?? 0}
            label={t("punches.summary.out")}
            active={focus === "out"}
            onClick={() => pressChip("out")}
          />
          <Chip
            icon={CircleX}
            tone="danger"
            count={data?.rejected ?? 0}
            label={t("punches.summary.rejected")}
            active={focus === "rejected"}
            onClick={() => pressChip("rejected")}
          />
          {(data?.flagged ?? 0) > 0 ? (
            <Chip
              icon={Flag}
              tone="warning"
              count={data?.flagged ?? 0}
              label={t("punches.summary.flagged")}
              active={focus === "flagged"}
              onClick={() => pressChip("flagged")}
            />
          ) : null}
          {(data?.offline ?? 0) > 0 ? (
            <Chip
              icon={Hourglass}
              tone="neutral"
              count={data?.offline ?? 0}
              label={t("punches.summary.offline")}
              active={focus === "offline"}
              onClick={() => pressChip("offline")}
            />
          ) : null}
          {isSuperAdmin && data?.dark_photos !== null && data?.dark_photos !== undefined ? (
            <Chip
              icon={Moon}
              tone="neutral"
              count={data.dark_photos}
              label={t("punches.summary.dark")}
              active={focus === "dark"}
              onClick={() => pressChip("dark")}
            />
          ) : null}
          {data?.asked_for_code !== undefined ? (
            <Chip
              icon={Keyboard}
              tone="neutral"
              count={data.asked_for_code}
              label={t("punches.summary.asked")}
              active={focus === "asked"}
              onClick={() => pressChip("asked")}
            />
          ) : null}
          {isSuperAdmin && data?.no_face_photos !== null && data?.no_face_photos !== undefined ? (
            <Chip
              icon={CircleDashed}
              tone="neutral"
              count={data.no_face_photos}
              label={t("punches.summary.noFace")}
              active={focus === "noFace"}
              onClick={() => pressChip("noFace")}
            />
          ) : null}
          <span className="text-xs text-muted-foreground">{t("punches.summary.hint")}</span>
        </div>
        {data && (data.face_accepted ?? 0) + (data.code_accepted ?? 0) > 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("punches.summary.acceptedBy")}{" "}
            <b className="tnum text-foreground">{formatNumber(data.face_accepted ?? 0)}</b>{" "}
            {t("punches.how.faceShort")} ·{" "}
            <b className="tnum text-foreground">{formatNumber(data.code_accepted ?? 0)}</b>{" "}
            {t("punches.how.codeShort")} ·{" "}
            <b className="tnum text-foreground">
              {formatNumber(
                Math.max(
                  0,
                  data.accepted_in +
                    data.accepted_out -
                    (data.face_accepted ?? 0) -
                    (data.code_accepted ?? 0),
                ),
              )}
            </b>{" "}
            {t("punches.how.cardShort")}
          </p>
        ) : null}
        {reasons.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">{t("punches.summary.because")}</span>
            {reasons.map(([code, count]) => (
              <button
                key={code}
                type="button"
                aria-pressed={reason === code}
                onClick={() =>
                  apply(() => {
                    setFocus("rejected");
                    setResult("rejected");
                    setDarkOnly(false);
                    setReason(reason === code ? "" : code);
                  })
                }
                className={cn(
                  "cursor-pointer rounded-full border bg-card px-3 py-1 text-xs font-semibold hover:bg-muted",
                  reason === code && "border-primary ring-2 ring-primary/30",
                )}
              >
                <span className="mr-1 font-bold text-destructive">{count}</span>
                {reasonText(code)}
              </button>
            ))}
          </div>
        ) : null}
      </section>

      <Card className="overflow-hidden p-0">
        <div className="flex flex-wrap items-center gap-2 border-b p-4">
          <span className="flex items-center gap-1 rounded-md border">
            <Button
              size="icon"
              variant="ghost"
              aria-label={t("punches.filter.previousDay")}
              onClick={() => apply(() => setDate(addDays(date, -1)))}
            >
              <ChevronLeft aria-hidden />
            </Button>
            <label className="flex items-center gap-2 px-1 text-sm font-semibold">
              <CalendarDays className="size-4" aria-hidden />
              <span className="sr-only">{t("punches.filter.date")}</span>
              {today ? <span>{t("punches.filter.today")}</span> : null}
              <input
                type="date"
                value={date}
                max={todayIst()}
                onChange={(event) => event.target.value && apply(() => setDate(event.target.value))}
                className="tnum bg-transparent"
              />
            </label>
            <Button
              size="icon"
              variant="ghost"
              aria-label={t("punches.filter.nextDay")}
              disabled={today}
              onClick={() => apply(() => setDate(addDays(date, 1)))}
            >
              <ChevronRight aria-hidden />
            </Button>
          </span>
          <span className="relative min-w-52 flex-1">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              aria-label={t("punches.filter.search")}
              placeholder={t("punches.filter.searchPlaceholder")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="pl-9"
            />
          </span>
          <Select
            aria-label={t("punches.filter.result")}
            value={askedOnly ? "asked" : result}
            onChange={(event) => {
              apply(() => {
                const chosen = event.target.value;
                setAskedOnly(chosen === "asked");
                setResult(chosen === "asked" ? "" : (chosen as typeof result));
                setFocus(chosen === "asked" ? "asked" : "all");
                setDarkOnly(false);
                setNoFaceOnly(false);
              });
            }}
            className="w-auto"
          >
            <option value="">{t("punches.filter.anyResult")}</option>
            <option value="accepted">{t("punches.result.accepted")}</option>
            <option value="flagged">{t("punches.result.flagged")}</option>
            <option value="rejected">{t("punches.result.rejected")}</option>
            <option value="asked">{t("punches.result.needsCode")}</option>
          </Select>
          <Select
            aria-label={t("punches.filter.offline")}
            value={offlineOnly ? "yes" : ""}
            onChange={(event) => apply(() => setOfflineOnly(event.target.value === "yes"))}
            className="w-auto"
          >
            <option value="">{t("punches.filter.anyOffline")}</option>
            <option value="yes">{t("punches.filter.savedOffline")}</option>
          </Select>
          <Select
            aria-label={t("punches.filter.review")}
            value={reviewState}
            onChange={(event) =>
              apply(() => setReviewState(event.target.value as typeof reviewState))
            }
            className="w-auto"
          >
            <option value="">{t("punches.filter.anyReview")}</option>
            <option value="to_check">{t("punches.review.toCheck")}</option>
            <option value="confirmed">{t("punches.review.confirmed")}</option>
            <option value="not_accepted">{t("punches.review.notAccepted")}</option>
            <option value="approved">{t("punches.review.approved")}</option>
          </Select>
          <Select
            aria-label={t("punches.filter.method")}
            value={method}
            onChange={(event) => apply(() => setMethod(event.target.value as MethodFilter))}
            className="w-auto"
          >
            <option value="">{t("punches.filter.anyMethod")}</option>
            <option value="face">{t("punches.method.face")}</option>
            <option value="code">{t("punches.method.faceByCode")}</option>
            <option value="qr">{t("punches.method.card")}</option>
          </Select>
          <Select
            aria-label={t("punches.filter.kiosk")}
            value={kioskId}
            onChange={(event) => apply(() => setKioskId(event.target.value))}
            className="w-auto"
          >
            <option value="">{t("punches.filter.anyKiosk")}</option>
            {(kiosks.data ?? []).map((kiosk) => (
              <option key={kiosk.id} value={kiosk.id}>
                {kiosk.name}
              </option>
            ))}
          </Select>
          <Select
            aria-label={t("punches.filter.reason")}
            value={reason}
            onChange={(event) => apply(() => setReason(event.target.value))}
            className="w-auto"
          >
            <option value="">{t("punches.filter.anyReason")}</option>
            {Object.keys(data?.rejected_by_reason ?? {}).map((code) => (
              <option key={code} value={code}>
                {reasonText(code)}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex items-center justify-between border-b bg-muted/40 px-4 py-2 text-sm text-muted-foreground">
          <span>{t("punches.count", { count: total, formatted: formatNumber(total) })}</span>
          {today ? (
            <span className="flex items-center gap-1.5">
              <Radio className="size-4 text-success" aria-hidden />
              <b className="text-foreground">{t("punches.live")}</b>
              {t("punches.liveEvery")}
            </span>
          ) : (
            <span>{formatDate(date)}</span>
          )}
        </div>

        {punches.isError ? (
          <Alert tone="danger" className="m-4">
            <span>{describeError(punches.error, t)}</span>
            <Button
              size="sm"
              variant="outline"
              className="ml-auto"
              onClick={() => punches.refetch()}
            >
              {t("common.tryAgain")}
            </Button>
          </Alert>
        ) : null}

        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>{t("punches.columns.time")}</TableHead>
              <TableHead>{t("punches.columns.employee")}</TableHead>
              <TableHead>{t("punches.columns.method")}</TableHead>
              <TableHead>{t("punches.columns.direction")}</TableHead>
              <TableHead>{t("punches.columns.resultAndReason")}</TableHead>
              <TableHead>{t("punches.columns.kiosk")}</TableHead>
              <TableHead>{t("punches.columns.photo")}</TableHead>
              <TableHead>
                <span className="sr-only">{t("punches.columns.actions")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {punches.isPending
              ? Array.from({ length: 6 }, (_, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: fixed placeholder rows
                  <TableRow key={index}>
                    <TableCell colSpan={8}>
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              : rows.map((punch) => (
                  <PunchRow
                    key={punch.id}
                    punch={punch}
                    isSuperAdmin={isSuperAdmin}
                    onViewPhoto={() => setPhotoFor({ id: punch.id, compare: false })}
                    onCompare={() => setPhotoFor({ id: punch.id, compare: true })}
                    onOpenDetail={setDetailId}
                  />
                ))}
            {!punches.isPending && rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                  {filtered
                    ? t("punches.noMatch")
                    : today
                      ? t("punches.empty")
                      : t("punches.emptyDay", { date: formatDate(date) })}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3 text-sm text-muted-foreground">
          <span>
            {t("punches.showing", {
              from: total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1,
              to: Math.min(page * PAGE_SIZE, total),
              total: formatNumber(total),
            })}
          </span>
          <span className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={page <= 1}
              aria-label={t("employees.previousPage")}
              onClick={() => setPage(page - 1)}
            >
              <ChevronLeft className="size-4" aria-hidden />
            </Button>
            <span className="tnum">{t("employees.pageOf", { page, pages: lastPage })}</span>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= lastPage}
              aria-label={t("employees.nextPage")}
              onClick={() => setPage(page + 1)}
            >
              <ChevronRight className="size-4" aria-hidden />
            </Button>
          </span>
        </div>
      </Card>

      {detailId ? (
        <PunchDetailSheet
          punchId={detailId}
          isSuperAdmin={isSuperAdmin}
          onClose={() => setDetailId(null)}
          onOpenPunch={setDetailId}
          onViewPhoto={(punch: PunchDetail) => {
            setDetailId(null);
            setPhotoFor({ id: punch.id, compare: false });
          }}
          onCompare={(punch: PunchDetail) => {
            setDetailId(null);
            setPhotoFor({ id: punch.id, compare: true });
          }}
        />
      ) : null}
      {photoFor ? (
        <PhotoDialog
          punches={withPhoto}
          startId={photoFor.id}
          startComparing={photoFor.compare}
          onClose={() => setPhotoFor(null)}
        />
      ) : null}
    </div>
  );
}

function PunchRow({
  punch,
  isSuperAdmin,
  onViewPhoto,
  onCompare,
  onOpenDetail,
}: {
  punch: PunchItem;
  isSuperAdmin: boolean;
  onViewPhoto: () => void;
  onCompare: () => void;
  onOpenDetail: (punchId: string) => void;
}) {
  const { t } = useTranslation();
  const hasPhoto = punch.snapshot.state === "stored";
  return (
    <TableRow
      className={cn(
        punch.decision === "rejected" && "border-l-4 border-l-destructive",
        (punch.decision === "needs_code" || punch.decision === "flagged") &&
          "border-l-4 border-l-warning",
      )}
    >
      <TableCell className="tnum font-semibold">
        {formatTimeWithSeconds(punch.punch_time ?? punch.server_received_at)}
      </TableCell>
      <TableCell>
        <EmployeeCell punch={punch} />
      </TableCell>
      <TableCell>
        <MethodBadge method={punch.method} />
      </TableCell>
      <TableCell>
        <DirectionBadge direction={punch.direction} />
      </TableCell>
      <TableCell>
        <ResultCell punch={punch} onOpenPunch={onOpenDetail} />
      </TableCell>
      <TableCell>
        <span className="block font-semibold">{punch.kiosk.name}</span>
        <span className="code text-xs text-muted-foreground">{punch.plant.code}</span>
      </TableCell>
      <TableCell>
        <PhotoStateCell punch={punch} showDark={isSuperAdmin} />
      </TableCell>
      <TableCell>
        <span className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            aria-label={t("punches.detail.openFor", {
              time: formatTimeWithSeconds(punch.server_received_at),
            })}
            onClick={() => onOpenDetail(punch.id)}
          >
            <PanelRight aria-hidden />
            {t("punches.detail.button")}
          </Button>
          {isSuperAdmin && hasPhoto ? (
            <span className="flex gap-2">
              <Button size="sm" variant="outline" onClick={onViewPhoto}>
                <Eye aria-hidden />
                {t("punches.photo.view")}
              </Button>
              {punch.employee ? (
                <Button size="sm" variant="ghost" onClick={onCompare}>
                  <Columns2 aria-hidden />
                  {t("punches.photo.compareShort")}
                </Button>
              ) : null}
            </span>
          ) : null}
        </span>
      </TableCell>
    </TableRow>
  );
}
