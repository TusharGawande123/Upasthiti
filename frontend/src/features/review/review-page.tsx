// "Needs review" (/admin/review, spec M4 §4.8, design gate B 01-list). Super Admin only: the menu
// entry is hidden from the other roles and the server answers them FORBIDDEN.
// Three tabs: flagged punches to check (they already count), rejected punches that may be
// approved, and punches already reviewed. The filters live in the address, so the dashboard
// digest and the review hints can link to a filtered list. After a review the next punch opens.
import {
  CircleCheck,
  CircleX,
  Filter,
  Flag,
  History,
  Hourglass,
  PanelRight,
  Radio,
  Search,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
import { usePlantFilter } from "@/app/layouts/plant-filter";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { describeError } from "@/features/auth/error-message";
import { useKiosks } from "@/features/kiosks/use-kiosks";
import { addDays } from "@/lib/dates";
import { formatDate, formatNumber, formatTime, todayIst } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  DirectionBadge,
  EmployeeCell,
  formatDelay,
  MethodBadge,
  ResultBadge,
  ReviewMark,
  useReasonText,
} from "../punches/punch-cells";
import { ReviewSheet } from "./review-sheet";
import {
  type ReviewAction,
  type ReviewFilters,
  type ReviewListItem,
  type ReviewTab,
  useReviewList,
  useReviewSummary,
} from "./use-review";

const PAGE_SIZE = 50;
const TABS: ReviewTab[] = ["to_check", "rejected", "reviewed"];
// Codes the "Code" filter offers: the M4 flags first, then the usual rejections.
const FLAG_CODES = [
  "LOCATION_AT_EDGE",
  "LOCATION_STALE",
  "IMPOSSIBLE_TRAVEL",
  "TWO_DEVICES_SOON",
  "OFFLINE_TIME_UNPROVEN",
  "OFFLINE_TOO_OLD",
  "SYNC_ORDER_CONFLICT",
];
const REJECTION_CODES = [
  "OUTSIDE_GEOFENCE",
  "GPS_ACCURACY_TOO_LOW",
  "LOCATION_REQUIRED",
  "WRONG_PLANT",
  "QR_EXPIRED",
  "QR_REVOKED",
  "SPOOF_SUSPECTED",
  "FACE_NOT_RECOGNISED",
  "OFFLINE_EVIDENCE_UNREADABLE",
];

/** Reads the list filters from the address (?tab=rejected&plant_id=...). */
function useAddressFilters() {
  const [params, setParams] = useSearchParams();
  const read = (key: string) => params.get(key) ?? "";
  const set = (changes: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    next.delete("page");
    setParams(next, { replace: true });
  };
  return { read, set, params };
}

function bool(value: string): boolean | undefined {
  return value === "true" ? true : value === "false" ? false : undefined;
}

export function ReviewPage() {
  const { t } = useTranslation();
  const reasonText = useReasonText();
  const { read, set } = useAddressFilters();
  const { plantId: shellPlantId } = usePlantFilter();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [search, setSearch] = useState(read("q"));
  // ?punch=<id> opens one punch at once (a link from the punch log).
  const [openId, setOpenId] = useState<string | null>(read("punch") || null);

  const tab = (TABS.includes(read("tab") as ReviewTab) ? read("tab") : "to_check") as ReviewTab;
  const today = todayIst();
  const dateTo = read("date_to") || today;
  const dateFrom = read("date_from") || addDays(dateTo, -6);
  const plantId = read("plant_id") || shellPlantId || "";
  const page = Number(read("page")) || 1;

  // Wait a moment after typing before asking the server.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only the typed text starts a search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (search !== read("q")) set({ q: search.trim() || undefined });
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const filters: ReviewFilters = {
    tab,
    date_from: dateFrom,
    date_to: dateTo,
    plant_id: plantId || undefined,
    kiosk_id: read("kiosk_id") || undefined,
    code: read("code") || undefined,
    method: (read("method") || undefined) as ReviewFilters["method"],
    was_offline: bool(read("was_offline")),
    employee_id: read("employee_id") || undefined,
    q: read("q") || undefined,
    names_employee: tab === "rejected" ? bool(read("names_employee")) : undefined,
    include_cooldown: tab === "rejected" && read("include_cooldown") === "true" ? true : undefined,
    page,
    page_size: PAGE_SIZE,
  };
  const list = useReviewList(filters);
  const summary = useReviewSummary(true);
  const kiosks = useKiosks({ plant_id: plantId || undefined });
  const rows = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const toCheck = summary.data?.to_check ?? 0;
  const activeFilters = [
    read("kiosk_id"),
    read("code"),
    read("method"),
    read("was_offline"),
    read("employee_id"),
    read("q"),
    tab === "rejected" ? read("names_employee") : "",
    tab === "rejected" ? read("include_cooldown") : "",
  ].filter(Boolean).length;
  const openIndex = rows.findIndex((row) => row.punch.id === openId);

  // After a review: the next row opens (fast work through a queue, spec §4.8).
  const afterReview = (action: ReviewAction) => {
    const next = rows[openIndex + 1] ?? rows[openIndex - 1] ?? null;
    const left = tab === "to_check" ? Math.max(0, toCheck - 1) : null;
    toast.success(
      [
        t(`review.toast.${action}`),
        next
          ? t("review.toast.next", {
              time: formatTime(next.punch.punch_time ?? next.punch.server_received_at),
              name: next.punch.employee?.name ?? t("review.row.unknown"),
            })
          : "",
        left !== null ? t("review.toast.left", { count: left }) : "",
      ]
        .filter(Boolean)
        .join(" · "),
    );
    setOpenId(next ? next.punch.id : null);
  };

  const emptyText =
    activeFilters > 0
      ? t("review.empty.filters")
      : tab === "to_check"
        ? t("review.empty.check")
        : tab === "rejected"
          ? t("review.empty.rejected")
          : t("review.empty.reviewed");

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">{t("review.title")}</h1>
        <p className="text-muted-foreground">{t("review.description")}</p>
      </header>

      <Card className="overflow-hidden p-0">
        <div
          role="tablist"
          aria-label={t("review.tabs.label")}
          className="flex gap-1 overflow-x-auto border-b px-2"
        >
          {TABS.map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={tab === name}
              onClick={() => set({ tab: name === "to_check" ? undefined : name })}
              className={cn(
                "-mb-px inline-flex h-12 shrink-0 cursor-pointer items-center gap-2 border-b-2 border-transparent px-3 text-sm font-semibold text-muted-foreground hover:text-foreground",
                tab === name && "border-primary text-primary",
              )}
            >
              {name === "to_check" ? <Flag className="size-4" aria-hidden /> : null}
              {name === "rejected" ? <CircleX className="size-4" aria-hidden /> : null}
              {name === "reviewed" ? <History className="size-4" aria-hidden /> : null}
              {t(`review.tabs.${name}`)}
              {name === "to_check" && toCheck > 0 ? (
                <span className="tnum rounded-full bg-warning px-2 text-xs font-bold text-white">
                  {formatNumber(toCheck)}
                  <span className="sr-only"> {t("review.badge", { count: toCheck })}</span>
                </span>
              ) : null}
            </button>
          ))}
        </div>

        <div className="space-y-3 border-b p-4">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">{t("review.filters.from")}</span>
              <input
                type="date"
                value={dateFrom}
                max={dateTo}
                onChange={(event) => event.target.value && set({ date_from: event.target.value })}
                className="tnum h-11 rounded-md border border-input bg-card px-2"
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">{t("review.filters.to")}</span>
              <input
                type="date"
                value={dateTo}
                max={today}
                onChange={(event) => event.target.value && set({ date_to: event.target.value })}
                className="tnum h-11 rounded-md border border-input bg-card px-2"
              />
            </label>
            <span className="relative min-w-48 flex-1">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                aria-label={t("review.filters.search")}
                placeholder={t("review.filters.search")}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="pl-9"
              />
            </span>
            <Button
              variant="outline"
              className="min-h-11 md:hidden"
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen(!filtersOpen)}
            >
              <Filter aria-hidden />
              {t("review.filters.toggle", { count: activeFilters })}
            </Button>
          </div>
          <div
            className={cn("flex-wrap items-center gap-2", filtersOpen ? "flex" : "hidden md:flex")}
          >
            <Select
              aria-label={t("review.filters.device")}
              value={read("kiosk_id")}
              onChange={(event) => set({ kiosk_id: event.target.value })}
              className="w-auto"
            >
              <option value="">{t("review.filters.anyDevice")}</option>
              {(kiosks.data ?? []).map((kiosk) => (
                <option key={kiosk.id} value={kiosk.id}>
                  {kiosk.name}
                </option>
              ))}
            </Select>
            <Select
              aria-label={t("review.filters.code")}
              value={read("code")}
              onChange={(event) => set({ code: event.target.value })}
              className="w-auto"
            >
              <option value="">{t("review.filters.anyCode")}</option>
              {(tab === "rejected" ? REJECTION_CODES : FLAG_CODES).map((code) => (
                <option key={code} value={code}>
                  {reasonText(code)}
                </option>
              ))}
            </Select>
            <Select
              aria-label={t("review.filters.method")}
              value={read("method")}
              onChange={(event) => set({ method: event.target.value })}
              className="w-auto"
            >
              <option value="">{t("review.filters.anyMethod")}</option>
              <option value="qr">{t("punches.method.card")}</option>
              <option value="face">{t("punches.method.face")}</option>
            </Select>
            <Select
              aria-label={t("review.filters.offline")}
              value={read("was_offline")}
              onChange={(event) => set({ was_offline: event.target.value })}
              className="w-auto"
            >
              <option value="">{t("review.filters.offlineAny")}</option>
              <option value="true">{t("review.filters.offlineYes")}</option>
              <option value="false">{t("review.filters.offlineNo")}</option>
            </Select>
            {tab === "rejected" ? (
              <>
                <Select
                  aria-label={t("review.filters.names")}
                  value={read("names_employee")}
                  onChange={(event) => set({ names_employee: event.target.value })}
                  className="w-auto"
                >
                  <option value="">{t("review.filters.namesAny")}</option>
                  <option value="true">{t("review.filters.namesYes")}</option>
                  <option value="false">{t("review.filters.namesNo")}</option>
                </Select>
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-5"
                    checked={read("include_cooldown") === "true"}
                    onChange={(event) =>
                      set({ include_cooldown: event.target.checked ? "true" : undefined })
                    }
                  />
                  <span>
                    {t("review.filters.showRepeats")}
                    <span className="block text-xs text-muted-foreground">
                      {t("review.filters.showRepeatsHelp")}
                    </span>
                  </span>
                </label>
              </>
            ) : null}
            {activeFilters > 0 ? (
              <Button
                variant="ghost"
                onClick={() => {
                  setSearch("");
                  set({
                    kiosk_id: undefined,
                    code: undefined,
                    method: undefined,
                    was_offline: undefined,
                    employee_id: undefined,
                    q: undefined,
                    names_employee: undefined,
                    include_cooldown: undefined,
                  });
                }}
              >
                {t("review.filters.clear")}
              </Button>
            ) : null}
          </div>
        </div>

        <div
          aria-live="polite"
          className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-4 py-2 text-sm text-muted-foreground"
        >
          <span>
            {t("review.count", { count: total, formatted: formatNumber(total) })} ·{" "}
            {formatDate(dateFrom)} – {formatDate(dateTo)}
          </span>
          <span className="flex items-center gap-1.5">
            <Radio className="size-4 text-success" aria-hidden />
            {t("review.liveEvery")}
          </span>
        </div>

        {list.isError ? (
          <Alert tone="danger" className="m-4">
            <TriangleAlert aria-hidden />
            <span>{describeError(list.error, t)}</span>
            <Button size="sm" variant="outline" className="ml-auto" onClick={() => list.refetch()}>
              {t("common.tryAgain")}
            </Button>
          </Alert>
        ) : null}

        <ul className="divide-y">
          {list.isPending
            ? Array.from({ length: 5 }, (_, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed placeholder rows
                <li key={index} className="p-4">
                  <Skeleton className="h-12 w-full" />
                </li>
              ))
            : rows.map((row) => (
                <ReviewRow
                  key={row.punch.id}
                  row={row}
                  tab={tab}
                  onOpen={() => setOpenId(row.punch.id)}
                />
              ))}
          {!list.isPending && rows.length === 0 ? (
            <li className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
              {tab === "to_check" && activeFilters === 0 ? (
                <CircleCheck className="size-8 text-success" aria-hidden />
              ) : null}
              <span>{emptyText}</span>
            </li>
          ) : null}
        </ul>

        {total > PAGE_SIZE ? (
          <div className="flex items-center justify-end gap-2 border-t px-4 py-3 text-sm">
            <Button
              size="sm"
              variant="outline"
              disabled={page <= 1}
              onClick={() => set({ page: String(page - 1) })}
            >
              {t("review.previousPage")}
            </Button>
            <span className="tnum">{t("employees.pageOf", { page, pages: lastPage })}</span>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= lastPage}
              onClick={() => set({ page: String(page + 1) })}
            >
              {t("review.nextPage")}
            </Button>
          </div>
        ) : null}
      </Card>

      {openId ? (
        <ReviewSheet
          key={openId}
          punchId={openId}
          position={openIndex >= 0 ? { index: openIndex, total: rows.length } : null}
          onClose={() => setOpenId(null)}
          onMove={(offset) => {
            const next = rows[openIndex + offset];
            if (next) setOpenId(next.punch.id);
          }}
          onReviewed={afterReview}
        />
      ) : null}
    </div>
  );
}

function ReviewRow({
  row,
  tab,
  onOpen,
}: {
  row: ReviewListItem;
  tab: ReviewTab;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const reasonText = useReasonText();
  const { punch } = row;
  const time = punch.punch_time ?? punch.server_received_at;
  const repeat = punch.reason_codes[0] === "COOLDOWN_ACTIVE";
  const names = punch.employee !== null || punch.claimed_employee !== null;
  const buttonText =
    tab === "reviewed"
      ? t("review.row.open")
      : repeat
        ? t("review.row.details")
        : t("review.row.review");
  return (
    <li
      className={cn(
        "grid gap-3 border-l-4 p-4 md:grid-cols-[7rem_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.4fr)_auto] md:items-start",
        tab === "reviewed"
          ? "border-l-border-strong"
          : punch.decision === "flagged"
            ? "border-l-warning"
            : "border-l-destructive",
        repeat && "opacity-70",
      )}
    >
      <div>
        <span className="tnum block font-semibold">{formatTime(time)}</span>
        <span className="tnum block text-xs text-muted-foreground">{formatDate(time)}</span>
        {punch.was_offline ? (
          <span className="mt-1 flex items-start gap-1 text-xs font-semibold text-warning">
            <Hourglass className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {t("review.row.savedOffline", {
              delay: formatDelay(punch.offline_delay_seconds ?? 0, t),
            })}
          </span>
        ) : null}
      </div>
      <div className="min-w-0">
        {punch.employee || !punch.claimed_employee ? (
          <EmployeeCell punch={punch} />
        ) : (
          <span className="block">
            <span className="block font-semibold">{punch.claimed_employee.name}</span>
            <span className="code text-xs text-muted-foreground">
              {punch.claimed_employee.code} · {t("review.row.codeTyped")}
            </span>
          </span>
        )}
      </div>
      <div className="min-w-0 text-sm">
        <span className="block font-semibold">{punch.kiosk.name}</span>
        <span className="code block text-xs text-muted-foreground">{punch.plant.code}</span>
        <span className="mt-1 inline-block">
          <MethodBadge method={punch.method} />
        </span>
      </div>
      <div className="min-w-0 space-y-1">
        <span className="flex flex-wrap items-center gap-1">
          <ResultBadge decision={punch.decision} />
          {punch.direction ? <DirectionBadge direction={punch.direction} /> : null}
        </span>
        {punch.reason_codes.map((code) => (
          <span key={code} className="block text-sm">
            {reasonText(code)} <span className="code text-xs text-muted-foreground">{code}</span>
          </span>
        ))}
        {tab === "rejected" ? (
          <span className="block text-xs text-muted-foreground">
            {repeat
              ? t("review.row.alreadyCounted")
              : names
                ? t("review.row.namesEmployee")
                : t("review.row.namesNobody")}
          </span>
        ) : null}
        <ReviewMark punch={punch} />
        <span className="block text-xs text-muted-foreground">
          {punch.snapshot.state === "stored"
            ? t("review.row.photoStored")
            : t("review.row.noPhoto")}
        </span>
      </div>
      <Button
        variant={tab === "to_check" ? "primary" : "outline"}
        className="min-h-11 w-full md:w-auto"
        aria-label={t("review.row.openFor", {
          name: punch.employee?.name ?? punch.claimed_employee?.name ?? t("review.row.unknown"),
          time: formatTime(time),
        })}
        onClick={onOpen}
      >
        <PanelRight aria-hidden />
        {buttonText}
      </Button>
    </li>
  );
}
