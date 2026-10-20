// QR cards page (/admin/qr-cards, spec §4.6): every active employee with the state of their
// latest card, with filters, paging and, for the Super Admin, row selection with bulk actions and
// a "Test cards" tab. All three roles may read the list (a Plant Head sees their own plant, set by
// the server); everyone else gets a read-only note and no buttons.
import {
  Ban,
  ChevronLeft,
  ChevronRight,
  FlaskConical,
  IdCard,
  Lock,
  Printer,
  QrCode,
  ScanFace,
  Users,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { describeError } from "@/features/auth/error-message";
import { useMe } from "@/features/auth/use-auth";
import { useContractors } from "@/features/contractors/use-contractors";
import { initialsOf, TypeBadge } from "@/features/employees/employee-badges";
import { useNamedItems } from "@/features/plants/use-plants";
import { formatDate, formatNumber } from "@/lib/format";
import { BulkIssueDialog, BulkRevokeDialog, PrintCardsDialog } from "./bulk-card-dialogs";
import { doable, planCardAction, planIssue } from "./bulk-plan";
import { CardStateBadge, ReprintBadge, useValidityHint } from "./card-badges";
import { TestCardsTab } from "./test-cards-tab";
import {
  type CardRow,
  type CardState,
  MAX_BULK,
  type Card as QrCard,
  useQrCards,
  useTestCards,
} from "./use-qr-cards";

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
  // Only the Super Admin changes, prints and revokes cards (decisions 0005 and 0009).
  const canChange = role === "super_admin";
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
  // Selected people, kept by id across pages (a person of another page stays selected).
  const [selected, setSelected] = useState<Map<string, CardRow>>(new Map());
  const [bulkDialog, setBulkDialog] = useState<"issue" | "revoke" | "print" | null>(null);

  // Wait a moment after typing before asking the server.
  useEffect(() => {
    const timer = setTimeout(() => {
      setTypedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // A different plant makes the category filter and the selection meaningless.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the plant changes
  useEffect(() => {
    setCategoryId("");
    setPage(1);
    setSelected(new Map());
  }, [plantId]);

  const categories = useNamedItems(plantId, "categories");
  const contractors = useContractors();
  const testCards = useTestCards(canChange);
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
  const readOnly = !canChange;
  const pageSelected = rows.length > 0 && rows.every((row) => selected.has(row.employee.id));

  const toggle = (row: CardRow) =>
    setSelected((current) => {
      const next = new Map(current);
      if (next.has(row.employee.id)) next.delete(row.employee.id);
      else next.set(row.employee.id, row);
      return next;
    });

  const togglePage = () =>
    setSelected((current) => {
      const next = new Map(current);
      for (const row of rows) {
        if (pageSelected) next.delete(row.employee.id);
        else next.set(row.employee.id, row);
      }
      return next;
    });

  const picked = useMemo(() => [...selected.values()], [selected]);
  const issueCount = doable(planIssue(picked)).length;
  const cardCount = doable(planCardAction(picked)).length;
  const tooManyToChange = picked.length > MAX_BULK;

  const change =
    <T,>(setter: (value: T) => void) =>
    (value: T) => {
      setter(value);
      setPage(1);
    };

  const employeesPanel = (
    <>
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
              {canChange ? (
                <TableHead className="w-10">
                  <input
                    type="checkbox"
                    aria-label={t("qrCards.selectPage")}
                    checked={pageSelected}
                    onChange={togglePage}
                    className="size-4"
                  />
                </TableHead>
              ) : null}
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
                    <TableCell colSpan={canChange ? 9 : 8}>
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              : rows.map((row) => (
                  <TableRow
                    key={row.employee.id}
                    className="cursor-pointer"
                    data-state={selected.has(row.employee.id) ? "selected" : undefined}
                    onClick={() => navigate(`/admin/employees/${row.employee.id}`)}
                  >
                    {canChange ? (
                      <TableCell onClick={(event) => event.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={t("qrCards.selectOne", { name: row.employee.name })}
                          checked={selected.has(row.employee.id)}
                          onChange={() => toggle(row)}
                          className="size-4"
                        />
                      </TableCell>
                    ) : null}
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

      {picked.length > 0 && canChange ? (
        <div className="fixed inset-x-4 bottom-4 z-40 mx-auto max-w-4xl space-y-2 lg:left-72">
          <div className="rounded-xl border bg-card p-3 text-sm shadow-lg">
            <p className="mb-1 font-semibold">
              {t("qrCards.bulk.hintTitle", { count: picked.length })}
            </p>
            <ul className="space-y-0.5 text-muted-foreground">
              <li>
                <b className="text-foreground">{t("qrCards.bulk.button.issue")}:</b>{" "}
                {t("qrCards.bulk.hint.issue", {
                  ok: issueCount,
                  skipped: picked.length - issueCount,
                })}
              </li>
              <li>
                <b className="text-foreground">{t("qrCards.bulk.button.print")}:</b>{" "}
                {t("qrCards.bulk.hint.print", { ok: cardCount, total: picked.length })}
              </li>
              <li>
                <b className="text-foreground">{t("qrCards.bulk.button.revoke")}:</b>{" "}
                {t("qrCards.bulk.hint.revoke", { ok: cardCount })}
              </li>
            </ul>
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-xl bg-foreground px-4 py-3 text-background shadow-lg">
            <span className="grid size-7 place-items-center rounded-full bg-signal text-sm font-bold text-foreground">
              {picked.length}
            </span>
            <span className="text-sm font-semibold">{t("qrCards.bulk.selected")}</span>
            {tooManyToChange ? (
              <span role="alert" className="text-sm text-signal">
                {t("qrCards.bulk.tooMany", { max: MAX_BULK })}
              </span>
            ) : null}
            <span className="ml-auto flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={issueCount === 0 || tooManyToChange}
                onClick={() => setBulkDialog("issue")}
              >
                <IdCard aria-hidden />
                {t("qrCards.bulk.button.issue")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={cardCount === 0}
                onClick={() => setBulkDialog("print")}
              >
                <Printer aria-hidden />
                {t("qrCards.bulk.button.print")}
              </Button>
              <Button
                size="sm"
                variant="danger"
                disabled={cardCount === 0 || tooManyToChange}
                onClick={() => setBulkDialog("revoke")}
              >
                <Ban aria-hidden />
                {t("qrCards.bulk.button.revoke")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-background hover:bg-background/15"
                aria-label={t("qrCards.bulk.clear")}
                onClick={() => setSelected(new Map())}
              >
                <X className="size-4" aria-hidden />
              </Button>
            </span>
          </div>
        </div>
      ) : null}

      {bulkDialog === "issue" ? (
        <BulkIssueDialog
          rows={picked}
          onClose={() => setBulkDialog(null)}
          onDone={() => setSelected(new Map())}
        />
      ) : null}
      {bulkDialog === "revoke" ? (
        <BulkRevokeDialog
          rows={picked}
          onClose={() => setBulkDialog(null)}
          onDone={() => setSelected(new Map())}
        />
      ) : null}
      {bulkDialog === "print" ? (
        <PrintCardsDialog
          rows={picked}
          onClose={() => setBulkDialog(null)}
          onDone={() => setSelected(new Map())}
        />
      ) : null}
    </>
  );

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

      {canChange ? (
        <Tabs defaultValue="employees">
          <TabsList>
            <TabsTrigger value="employees">
              <Users aria-hidden />
              {t("qrCards.tabs.employees")}
              <Badge tone="neutral">{formatNumber(total)}</Badge>
            </TabsTrigger>
            <TabsTrigger value="test">
              <FlaskConical aria-hidden />
              {t("qrCards.tabs.test")}
              <Badge tone="neutral">{formatNumber(testCards.data?.length ?? 0)}</Badge>
            </TabsTrigger>
          </TabsList>
          <TabsContent value="employees" className="space-y-5">
            {employeesPanel}
          </TabsContent>
          <TabsContent value="test">
            <TestCardsTab />
          </TabsContent>
        </Tabs>
      ) : (
        employeesPanel
      )}
    </div>
  );
}
