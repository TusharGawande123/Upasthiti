// Employees page: a server-paged table (650 people) with search, filters, row selection and a
// bulk bar. The plant comes from the top-bar plant filter. A Corporate Head's changes are
// sent for approval (the banner and the bar say so); a Plant Head only reads.
import { ChevronLeft, ChevronRight, FileSpreadsheet, Plus, ShieldCheck, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";
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
import { useContractors } from "@/features/contractors/use-contractors";
import { useNamedItems } from "@/features/plants/use-plants";
import { formatNumber, formatRupees } from "@/lib/format";
import { BulkDialog } from "./bulk-dialog";
import { ChangeWaiting, EmployeeStatusBadge, initialsOf, TypeBadge } from "./employee-badges";
import {
  type BulkAction,
  type Employee,
  type EmployeeStatus,
  type EmployeeType,
  MAX_BULK,
  useEmployees,
} from "./use-employees";

const PAGE_SIZE = 50;

export function EmployeesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const me = useMe();
  const role = me.data?.role;
  const canChange = role === "super_admin" || role === "corporate_head";
  const { plantId } = usePlantFilter();

  const [search, setSearch] = useState("");
  const [typedSearch, setTypedSearch] = useState("");
  const [status, setStatus] = useState<EmployeeStatus>("active");
  const [type, setType] = useState<EmployeeType | "">("");
  const [categoryId, setCategoryId] = useState("");
  const [contractorId, setContractorId] = useState("");
  const [page, setPage] = useState(1);
  // Selected people, kept by id across pages. Employees of other pages are remembered here.
  const [selected, setSelected] = useState<Map<string, Employee>>(new Map());
  const [bulkAction, setBulkAction] = useState<BulkAction | null>(null);

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
  const employees = useEmployees({
    q: typedSearch.trim() || undefined,
    plant_id: plantId || undefined,
    type: type || undefined,
    status,
    category_id: categoryId || undefined,
    contractor_id: contractorId || undefined,
    page,
    page_size: PAGE_SIZE,
  });

  const rows = employees.data?.items ?? [];
  const total = employees.data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageSelected = rows.length > 0 && rows.every((row) => selected.has(row.id));

  const toggle = (employee: Employee) =>
    setSelected((current) => {
      const next = new Map(current);
      if (next.has(employee.id)) next.delete(employee.id);
      else next.set(employee.id, employee);
      return next;
    });

  const togglePage = () =>
    setSelected((current) => {
      const next = new Map(current);
      for (const row of rows) {
        if (pageSelected) next.delete(row.id);
        else next.set(row.id, row);
      }
      return next;
    });

  const picked = useMemo(() => [...selected.values()], [selected]);
  const pickedPlants = new Set(picked.map((employee) => employee.plant_id));
  const mixedPlants = pickedPlants.size > 1;
  const tooMany = picked.length > MAX_BULK;
  const bulkPlantId = pickedPlants.size === 1 ? ([...pickedPlants][0] ?? "") : "";
  const forApproval = role === "corporate_head";

  const bulkButton = (action: BulkAction, danger = false) => (
    <Button
      size="sm"
      variant={danger ? "danger" : "outline"}
      disabled={mixedPlants || tooMany}
      onClick={() => setBulkAction(action)}
    >
      {t(`employees.bulk.button.${action}`)}
    </Button>
  );

  return (
    <div className="mx-auto max-w-7xl space-y-5 pb-24">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">{t("employees.title")}</h1>
          <p className="max-w-xl text-sm text-muted-foreground">{t("employees.subtitle")}</p>
        </div>
        {canChange ? (
          <div className="flex gap-2">
            <Link
              to="/admin/import"
              className="inline-flex h-10 items-center gap-2 rounded-md border border-border-strong bg-card px-4 text-sm font-semibold shadow-xs hover:bg-muted"
            >
              <FileSpreadsheet className="size-4" aria-hidden />
              {t("employees.importExcel")}
            </Link>
            <Button onClick={() => navigate("/admin/employees/new")}>
              <Plus aria-hidden />
              {t("employees.add")}
            </Button>
          </div>
        ) : null}
      </div>

      {forApproval ? (
        <Alert tone="info">
          <ShieldCheck aria-hidden />
          <span>
            <b>{t("employees.approvalBanner.title")}</b> {t("employees.approvalBanner.text")}{" "}
            <Link to="/admin/my-requests" className="font-semibold underline">
              {t("nav.myRequests")}
            </Link>
          </span>
        </Alert>
      ) : null}

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b p-4">
          <Input
            type="search"
            placeholder={t("employees.searchPlaceholder")}
            aria-label={t("employees.searchPlaceholder")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="max-w-xs"
          />
          <Select
            aria-label={t("employees.filter.status")}
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as EmployeeStatus);
              setPage(1);
            }}
            className="w-auto"
          >
            <option value="active">{t("employees.filter.active")}</option>
            <option value="left">{t("employees.filter.left")}</option>
          </Select>
          <Select
            aria-label={t("employees.filter.type")}
            value={type}
            onChange={(event) => {
              setType(event.target.value as EmployeeType | "");
              setPage(1);
            }}
            className="w-auto"
          >
            <option value="">{t("employees.filter.anyType")}</option>
            <option value="permanent">{t("employees.type.permanent")}</option>
            <option value="temporary">{t("employees.type.temporary")}</option>
          </Select>
          {plantId ? (
            <Select
              aria-label={t("employees.filter.category")}
              value={categoryId}
              onChange={(event) => {
                setCategoryId(event.target.value);
                setPage(1);
              }}
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
            aria-label={t("employees.filter.contractor")}
            value={contractorId}
            onChange={(event) => {
              setContractorId(event.target.value);
              setPage(1);
            }}
            className="w-auto"
          >
            <option value="">{t("employees.filter.anyContractor")}</option>
            {contractors.data?.map((contractor) => (
              <option key={contractor.id} value={contractor.id}>
                {contractor.name}
              </option>
            ))}
          </Select>
        </div>

        {employees.isError ? (
          <Alert tone="danger" className="m-4">
            <span>{describeError(employees.error, t)}</span>
            <Button
              size="sm"
              variant="outline"
              className="ml-auto"
              onClick={() => employees.refetch()}
            >
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
                    aria-label={t("employees.selectPage")}
                    checked={pageSelected}
                    onChange={togglePage}
                    className="size-4"
                  />
                </TableHead>
              ) : null}
              <TableHead>{t("employees.columns.code")}</TableHead>
              <TableHead>{t("employees.columns.name")}</TableHead>
              <TableHead>{t("employees.columns.type")}</TableHead>
              <TableHead>{t("employees.columns.plant")}</TableHead>
              <TableHead>{t("employees.columns.category")}</TableHead>
              <TableHead>{t("employees.columns.department")}</TableHead>
              <TableHead>{t("employees.columns.shift")}</TableHead>
              <TableHead>{t("employees.columns.contractor")}</TableHead>
              <TableHead className="text-right">{t("employees.columns.otRate")}</TableHead>
              <TableHead>{t("employees.columns.status")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {employees.isPending
              ? Array.from({ length: 6 }, (_, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: fixed placeholder rows
                  <TableRow key={index}>
                    <TableCell colSpan={canChange ? 11 : 10}>
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              : rows.map((employee) => (
                  <TableRow
                    key={employee.id}
                    className="cursor-pointer"
                    data-state={selected.has(employee.id) ? "selected" : undefined}
                    onClick={() => navigate(`/admin/employees/${employee.id}`)}
                  >
                    {canChange ? (
                      <TableCell onClick={(event) => event.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={t("employees.selectOne", { name: employee.full_name })}
                          checked={selected.has(employee.id)}
                          onChange={() => toggle(employee)}
                          className="size-4"
                        />
                      </TableCell>
                    ) : null}
                    <TableCell className="code font-bold">{employee.employee_code}</TableCell>
                    <TableCell>
                      <span className="flex items-center gap-2">
                        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary-soft text-xs font-bold text-primary-soft-foreground">
                          {initialsOf(employee.full_name)}
                        </span>
                        <span>
                          <Link
                            to={`/admin/employees/${employee.id}`}
                            className="block font-semibold hover:underline"
                            onClick={(event) => event.stopPropagation()}
                          >
                            {employee.full_name}
                          </Link>
                          {employee.has_pending_change ? <ChangeWaiting /> : null}
                        </span>
                      </span>
                    </TableCell>
                    <TableCell>
                      <TypeBadge type={employee.type} />
                    </TableCell>
                    <TableCell className="code font-bold">{employee.plant_code}</TableCell>
                    <TableCell>{employee.category_name}</TableCell>
                    <TableCell>{employee.department_name ?? "–"}</TableCell>
                    <TableCell>{employee.shift_name ?? "–"}</TableCell>
                    <TableCell className="max-w-40 truncate">
                      {employee.contractor_name ?? "–"}
                    </TableCell>
                    <TableCell className="tnum text-right">
                      {employee.ot_rate_per_hour ? (
                        `${formatRupees(employee.ot_rate_per_hour)}/h`
                      ) : (
                        <span className="text-warning">{t("employees.missing")}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <EmployeeStatusBadge status={employee.status} />
                    </TableCell>
                  </TableRow>
                ))}
          </TableBody>
        </Table>

        {employees.data && rows.length === 0 ? (
          <p className="p-10 text-center text-muted-foreground">
            {typedSearch || type || categoryId || contractorId
              ? t("employees.noMatch")
              : t("employees.empty")}
          </p>
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
        <div className="fixed inset-x-4 bottom-4 z-40 mx-auto flex max-w-4xl flex-wrap items-center gap-2 rounded-xl bg-foreground px-4 py-3 text-background shadow-lg lg:left-72">
          <span className="grid size-7 place-items-center rounded-full bg-signal text-sm font-bold text-foreground">
            {picked.length}
          </span>
          <span className="text-sm font-semibold">{t("employees.selected")}</span>
          {mixedPlants ? (
            <span role="alert" className="text-sm text-signal">
              {t("employees.bulk.mixedPlants")}
            </span>
          ) : tooMany ? (
            <span role="alert" className="text-sm text-signal">
              {t("employees.bulk.tooMany", { max: MAX_BULK })}
            </span>
          ) : forApproval ? (
            <span className="text-sm opacity-80">{t("employees.bulk.sendForApprovalLabel")}</span>
          ) : null}
          <span className="ml-auto flex flex-wrap gap-2">
            {bulkButton("change_shift")}
            {bulkButton("change_category")}
            {bulkButton("change_department")}
            {role === "super_admin" ? bulkButton("mark_left", true) : null}
            <Button
              size="sm"
              variant="ghost"
              className="text-background hover:bg-background/15"
              aria-label={t("employees.clearSelection")}
              onClick={() => setSelected(new Map())}
            >
              <X className="size-4" aria-hidden />
            </Button>
          </span>
        </div>
      ) : null}

      <BulkDialog
        action={bulkAction}
        plantId={bulkPlantId}
        employeeIds={picked.map((employee) => employee.id)}
        forApproval={forApproval}
        onClose={() => setBulkAction(null)}
        onDone={() => setSelected(new Map())}
      />
    </div>
  );
}
