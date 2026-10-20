// QR cards page (/admin/qr-cards, spec §4.6): every active employee with the state of their
// latest card, with filters and paging. All three roles may read it (a Plant Head sees their own
// plant, set by the server). Only the Super Admin changes cards; others see a read-only note.
import { ChevronLeft, ChevronRight, Lock, Printer, QrCode, ScanFace } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";
import { usePlantFilter } from "@/app/layouts/plant-filter";
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
import { useContractors } from "@/features/contractors/use-contractors";
import { initialsOf, TypeBadge } from "@/features/employees/employee-badges";
import { useNamedItems } from "@/features/plants/use-plants";
import { formatDate, formatNumber } from "@/lib/format";
import { CardStateBadge, ReprintBadge, useValidityHint } from "./card-badges";
import { type CardRow, type CardState, type Card as QrCard, useQrCards } from "./use-qr-cards";

const PAGE_SIZE = 50;
const STATES: CardState[] = ["none", "active", "expiring", "not_yet_valid", "expired", "revoked"];

// "Valid until" with a small line under it: how many days are left, or when it was revoked.
function ValidUntilCell({ card }: { card: QrCard | null }) {
  if (!card) return <span className="text-muted-foreground">–</span>;
  return <ValidUntilDetails card={card} />;
}

function ValidUntilDetails({ card }: { card: QrCard }) {
  const { t } = useTranslation();
  const hint = useValidityHint(card);
  return (
    <span className="tnum block">
      <span className="block">{formatDate(card.valid_until)}</span>
      <span
        className={
          card.state === "expiring"
            ? "text-xs font-semibold text-warning"
            : "text-xs text-muted-foreground"
        }
      >
        {card.state === "revoked" && card.revoked_at
          ? t("qrCards.relative.revokedOn", { date: formatDate(card.revoked_at) })
          : hint}
      </span>
    </span>
  );
}

function PrintedCell({ row }: { row: CardRow }) {
  const { t } = useTranslation();
  const card = row.card;
  if (!card) return <span className="text-muted-foreground">–</span>;
  if (card.print_count === 0) {
    return (
      <Badge tone="neutral">
        <Printer aria-hidden />
        {t("qrCards.notPrinted")}
      </Badge>
    );
  }
  return (
    <span className="tnum block">
      <span className="block">{t("qrCards.printedTimes", { count: card.print_count })}</span>
      {card.last_printed_at ? (
        <span className="text-xs text-muted-foreground">
          {t("qrCards.lastPrinted", { date: formatDate(card.last_printed_at) })}
        </span>
      ) : null}
    </span>
  );
}

export function QrCardsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const me = useMe();
  const role = me.data?.role;
  const { plantId } = usePlantFilter();

  const [search, setSearch] = useState("");
  const [typedSearch, setTypedSearch] = useState("");
  const [type, setType] = useState<"" | "permanent" | "temporary">("");
  const [punchMethod, setPunchMethod] = useState<"" | "face" | "qr">("");
  const [contractorId, setContractorId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [state, setState] = useState<"" | CardState>("");
  const [printed, setPrinted] = useState<"" | "yes" | "no">("");
  const [reprintOnly, setReprintOnly] = useState(false);
  const [page, setPage] = useState(1);

  // Wait a moment after typing before asking the server.
  useEffect(() => {
    const timer = setTimeout(() => {
      setTypedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // A different plant makes the category filter meaningless.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the plant changes
  useEffect(() => {
    setCategoryId("");
    setPage(1);
  }, [plantId]);

  const categories = useNamedItems(plantId, "categories");
  const contractors = useContractors();
  const cards = useQrCards({
    q: typedSearch.trim() || undefined,
    plant_id: plantId || undefined,
    type: type || undefined,
    punch_method: punchMethod || undefined,
    contractor_id: contractorId || undefined,
    category_id: categoryId || undefined,
    state: state || undefined,
    printed: printed === "" ? undefined : printed === "yes",
    reprint_needed: reprintOnly || undefined,
    page,
    page_size: PAGE_SIZE,
  });

  const rows = cards.data?.items ?? [];
  const total = cards.data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = Boolean(
    typedSearch ||
      type ||
      punchMethod ||
      contractorId ||
      categoryId ||
      state ||
      printed ||
      reprintOnly,
  );
  const readOnly = role !== "super_admin";

  const change =
    <T,>(setter: (value: T) => void) =>
    (value: T) => {
      setter(value);
      setPage(1);
    };

  return (
    <div className="mx-auto max-w-7xl space-y-5 pb-24">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">{t("qrCards.title")}</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">{t("qrCards.subtitle")}</p>
        </div>
        {readOnly ? (
          <Badge tone="neutral">
            <Lock aria-hidden />
            {t("qrCards.readOnly")}
          </Badge>
        ) : null}
      </div>

      {readOnly ? (
        <Alert tone="info">
          <Lock aria-hidden />
          <span>
            <b>
              {role === "plant_head"
                ? t("qrCards.readOnlyBanner.plantHead")
                : t("qrCards.readOnlyBanner.corporateHead")}
            </b>{" "}
            {t("qrCards.readOnlyBanner.text")}
          </span>
        </Alert>
      ) : null}

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b p-4">
          <Input
            type="search"
            placeholder={t("qrCards.searchPlaceholder")}
            aria-label={t("qrCards.searchPlaceholder")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="max-w-xs"
          />
          <Select
            aria-label={t("qrCards.filter.type")}
            value={type}
            onChange={(event) => change(setType)(event.target.value as typeof type)}
            className="w-auto"
          >
            <option value="">{t("qrCards.filter.anyType")}</option>
            <option value="permanent">{t("employees.type.permanent")}</option>
            <option value="temporary">{t("employees.type.temporary")}</option>
          </Select>
          <Select
            aria-label={t("qrCards.filter.punchMethod")}
            value={punchMethod}
            onChange={(event) => change(setPunchMethod)(event.target.value as typeof punchMethod)}
            className="w-auto"
          >
            <option value="">{t("qrCards.filter.anyMethod")}</option>
            <option value="qr">{t("employees.punch.qr")}</option>
            <option value="face">{t("employees.punch.face")}</option>
          </Select>
          <Select
            aria-label={t("qrCards.filter.contractor")}
            value={contractorId}
            onChange={(event) => change(setContractorId)(event.target.value)}
            className="w-auto"
          >
            <option value="">{t("employees.filter.anyContractor")}</option>
            {contractors.data?.map((contractor) => (
              <option key={contractor.id} value={contractor.id}>
                {contractor.name}
              </option>
            ))}
          </Select>
          {plantId ? (
            <Select
              aria-label={t("qrCards.filter.category")}
              value={categoryId}
              onChange={(event) => change(setCategoryId)(event.target.value)}
              className="w-auto"
            >
              <option value="">{t("employees.filter.anyCategory")}</option>
              {categories.data?.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
          ) : null}
          <Select
            aria-label={t("qrCards.filter.state")}
            value={state}
            onChange={(event) => change(setState)(event.target.value as typeof state)}
            className="w-auto"
          >
            <option value="">{t("qrCards.filter.anyState")}</option>
            {STATES.map((value) => (
              <option key={value} value={value}>
                {t(`qrCards.state.${value}`)}
              </option>
            ))}
          </Select>
          <Select
            aria-label={t("qrCards.filter.printed")}
            value={printed}
            onChange={(event) => change(setPrinted)(event.target.value as typeof printed)}
            className="w-auto"
          >
            <option value="">{t("qrCards.filter.anyPrinted")}</option>
            <option value="yes">{t("qrCards.filter.printedYes")}</option>
            <option value="no">{t("qrCards.filter.printedNo")}</option>
          </Select>
          <Button
            size="sm"
            variant={reprintOnly ? "primary" : "outline"}
            aria-pressed={reprintOnly}
            onClick={() => change(setReprintOnly)(!reprintOnly)}
          >
            <Printer aria-hidden />
            {t("qrCards.filter.reprintOnly")}
          </Button>
        </div>

        {cards.isError ? (
          <Alert tone="danger" className="m-4">
            <span>{describeError(cards.error, t)}</span>
            <Button size="sm" variant="outline" className="ml-auto" onClick={() => cards.refetch()}>
              {t("common.tryAgain")}
            </Button>
          </Alert>
        ) : null}

        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>{t("qrCards.columns.employee")}</TableHead>
              <TableHead>{t("qrCards.columns.typeMethod")}</TableHead>
              <TableHead>{t("qrCards.columns.plant")}</TableHead>
              <TableHead>{t("qrCards.columns.contractor")}</TableHead>
              <TableHead>{t("qrCards.columns.card")}</TableHead>
              <TableHead>{t("qrCards.columns.state")}</TableHead>
              <TableHead>{t("qrCards.columns.validUntil")}</TableHead>
              <TableHead>{t("qrCards.columns.printed")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cards.isPending
              ? Array.from({ length: 6 }, (_, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: fixed placeholder rows
                  <TableRow key={index}>
                    <TableCell colSpan={8}>
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              : rows.map((row) => (
                  <TableRow
                    key={row.employee.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/admin/employees/${row.employee.id}`)}
                  >
                    <TableCell>
                      <span className="flex items-center gap-2">
                        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary-soft text-xs font-bold text-primary-soft-foreground">
                          {initialsOf(row.employee.name)}
                        </span>
                        <span>
                          <Link
                            to={`/admin/employees/${row.employee.id}`}
                            className="block font-semibold hover:underline"
                            onClick={(event) => event.stopPropagation()}
                          >
                            {row.employee.name}
                          </Link>
                          <span className="code text-xs text-muted-foreground">
                            {row.employee.code}
                          </span>
                        </span>
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="flex flex-col items-start gap-1">
                        <TypeBadge type={row.employee.type} />
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          {row.employee.punch_method === "qr" ? (
                            <QrCode className="size-3.5" aria-hidden />
                          ) : (
                            <ScanFace className="size-3.5" aria-hidden />
                          )}
                          {t(`employees.punch.${row.employee.punch_method}`)}
                        </span>
                      </span>
                    </TableCell>
                    <TableCell className="code font-bold">{row.employee.plant.code}</TableCell>
                    <TableCell className="max-w-32 truncate">
                      {row.employee.contractor?.name ?? "–"}
                    </TableCell>
                    <TableCell className="code font-bold">{row.card?.serial ?? "–"}</TableCell>
                    <TableCell>
                      <span className="flex flex-col items-start gap-1">
                        <CardStateBadge state={row.card?.state ?? "none"} />
                        {row.card ? <ReprintBadge card={row.card} /> : null}
                      </span>
                    </TableCell>
                    <TableCell>
                      <ValidUntilCell card={row.card} />
                    </TableCell>
                    <TableCell>
                      <PrintedCell row={row} />
                    </TableCell>
                  </TableRow>
                ))}
          </TableBody>
        </Table>

        {cards.data && rows.length === 0 ? (
          <div className="space-y-3 p-10 text-center text-muted-foreground">
            <p>{filtered ? t("qrCards.noMatch") : t("qrCards.empty")}</p>
            {filtered ? null : (
              <p className="text-sm">
                {t("qrCards.emptyHelp")}{" "}
                <Link to="/admin/employees" className="font-semibold text-primary underline">
                  {t("qrCards.goToEmployees")}
                </Link>
              </p>
            )}
          </div>
        ) : null}

        <div className="flex items-center justify-between border-t px-4 py-3 text-sm text-muted-foreground">
          <span className="tnum">
            {total === 0
              ? ""
              : t("employees.showing", {
                  from: formatNumber((page - 1) * PAGE_SIZE + 1),
                  to: formatNumber(Math.min(page * PAGE_SIZE, total)),
                  total: formatNumber(total),
                })}
          </span>
          <div className="flex items-center gap-2">
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
          </div>
        </div>
      </Card>
    </div>
  );
}
