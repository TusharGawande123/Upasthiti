// Add or edit an employee. The employee code is typed by the admin (the company's own code,
// 1–12 letters/digits, never reused) and cannot change later. The plant cannot change here
// either: moving a person is a "transfer". Contractor and hourly rate exist only for temporary
// workers. No phone number is asked or stored. A Corporate Head's save is "Send for approval".
import { Loader2, QrCode, ScanFace, ShieldCheck } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { usePlantFilter } from "@/app/layouts/plant-filter";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { describeError } from "@/features/auth/error-message";
import { useMe } from "@/features/auth/use-auth";
import { useContractors } from "@/features/contractors/use-contractors";
import { useNamedItems, usePlants, useShifts } from "@/features/plants/use-plants";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import {
  type EmployeeChanges,
  type EmployeeType,
  isPendingApproval,
  type NewEmployee,
  useCreateEmployee,
  useEmployee,
  useUpdateEmployee,
} from "./use-employees";

const CODE_PATTERN = /^[A-Za-z0-9._-]{1,12}$/;
const MONEY_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;

type FormValues = {
  employee_code: string;
  full_name: string;
  type: EmployeeType;
  plant_id: string;
  category_id: string;
  department_id: string;
  shift_id: string;
  shift_from: string;
  contractor_id: string;
  hourly_rate: string;
  ot_rate_per_hour: string;
  joined_on: string;
  reason: string;
};

type Errors = Partial<Record<keyof FormValues, string>>;

const today = () => new Date().toISOString().slice(0, 10);

// The server says which field a problem belongs to (details.field); our field names differ a bit.
const SERVER_FIELD: Record<string, keyof FormValues> = {
  employee_code: "employee_code",
  full_name: "full_name",
  type: "type",
  plant: "plant_id",
  category: "category_id",
  department: "department_id",
  shift: "shift_id",
  contractor: "contractor_id",
  hourly_rate: "hourly_rate",
  ot_rate_per_hour: "ot_rate_per_hour",
  joined_on: "joined_on",
};

export function EmployeeFormPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { employeeId } = useParams();
  const editing = employeeId !== undefined;
  const me = useMe();
  const forApproval = me.data?.role === "corporate_head";
  const { plantId: filterPlantId } = usePlantFilter();
  const existing = useEmployee(employeeId ?? "");
  const plants = usePlants({ is_active: true });
  const contractors = useContractors();

  const [values, setValues] = useState<FormValues>({
    employee_code: "",
    full_name: "",
    type: "permanent",
    plant_id: filterPlantId,
    category_id: "",
    department_id: "",
    shift_id: "",
    shift_from: today(),
    contractor_id: "",
    hourly_rate: "",
    ot_rate_per_hour: "",
    joined_on: today(),
    reason: "",
  });
  const [errors, setErrors] = useState<Errors>({});
  const [loaded, setLoaded] = useState(!editing);

  // Fill the form once from the saved employee when editing.
  useEffect(() => {
    const employee = existing.data?.employee;
    if (!editing || !employee || loaded) return;
    setValues((current) => ({
      ...current,
      employee_code: employee.employee_code,
      full_name: employee.full_name,
      type: employee.type,
      plant_id: employee.plant_id,
      category_id: employee.category_id,
      department_id: employee.department_id ?? "",
      shift_id: employee.shift_id ?? "",
      contractor_id: employee.contractor_id ?? "",
      hourly_rate: employee.hourly_rate ?? "",
      ot_rate_per_hour: employee.ot_rate_per_hour ?? "",
      joined_on: employee.joined_on,
    }));
    setLoaded(true);
  }, [editing, existing.data, loaded]);

  const plantId = values.plant_id;
  const categories = useNamedItems(plantId, "categories");
  const departments = useNamedItems(plantId, "departments");
  const shifts = useShifts(plantId);
  const create = useCreateEmployee();
  const update = useUpdateEmployee(employeeId ?? "");
  const mutation = editing ? update : create;
  const temporary = values.type === "temporary";

  const set = <Key extends keyof FormValues>(key: Key, value: FormValues[Key]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const validate = (): Errors => {
    const found: Errors = {};
    if (!editing && !CODE_PATTERN.test(values.employee_code.trim()))
      found.employee_code = t("employees.form.errors.code");
    if (!values.full_name.trim()) found.full_name = t("validation.name.required");
    if (!values.plant_id) found.plant_id = t("employees.form.errors.plant");
    if (!values.category_id) found.category_id = t("employees.form.errors.category");
    if (!values.shift_id) found.shift_id = t("employees.form.errors.shift");
    if (temporary && !MONEY_PATTERN.test(values.hourly_rate))
      found.hourly_rate = t("employees.form.errors.hourlyRate");
    if (values.ot_rate_per_hour && !MONEY_PATTERN.test(values.ot_rate_per_hour))
      found.ot_rate_per_hour = t("employees.form.errors.money");
    if (!values.joined_on) found.joined_on = t("employees.form.errors.joinedOn");
    return found;
  };

  const onDone = (result: unknown, goTo: string) => {
    toast.success(isPendingApproval(result) ? t("employees.form.sent") : t("employees.form.saved"));
    navigate(goTo);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    const common = {
      full_name: values.full_name.trim(),
      type: values.type,
      category_id: values.category_id,
      department_id: values.department_id || null,
      shift_id: values.shift_id,
      contractor_id: temporary ? values.contractor_id || null : null,
      hourly_rate: temporary ? values.hourly_rate : null,
      ot_rate_per_hour: values.ot_rate_per_hour || null,
      joined_on: values.joined_on,
    };
    const onError = (error: unknown) => {
      // Put the server's message under the right field when it names one.
      if (error instanceof ApiError && typeof error.details.field === "string") {
        const field = SERVER_FIELD[error.details.field];
        if (field) setErrors({ [field]: describeError(error, t) });
      }
    };

    if (editing) {
      const changes: EmployeeChanges = { ...common };
      const shiftChanged = values.shift_id !== (existing.data?.employee.shift_id ?? "");
      if (shiftChanged) changes.shift_from = values.shift_from;
      if (values.reason.trim()) changes.reason = values.reason.trim();
      update.mutate(changes, {
        onSuccess: (result) => onDone(result, `/admin/employees/${employeeId}`),
        onError,
      });
    } else {
      const input: NewEmployee = {
        ...common,
        employee_code: values.employee_code.trim().toUpperCase(),
        plant_id: values.plant_id,
      };
      create.mutate(input, { onSuccess: (result) => onDone(result, "/admin/employees"), onError });
    }
  };

  if (editing && existing.isError) {
    return <Alert tone="danger">{describeError(existing.error, t)}</Alert>;
  }
  if (editing && !loaded) return <Skeleton className="mx-auto h-96 max-w-3xl" />;

  const topError =
    mutation.error instanceof ApiError && typeof mutation.error.details.field === "string"
      ? null
      : mutation.error;
  const plantOptions = plants.data?.items ?? [];
  const shiftChanged = editing && values.shift_id !== (existing.data?.employee.shift_id ?? "");

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <Link to="/admin/employees" className="text-[13px] text-muted-foreground hover:underline">
          {t("employees.title")}
        </Link>
        <h1 className="text-[26px] font-bold tracking-tight">
          {editing ? t("employees.form.editTitle") : t("employees.form.addTitle")}
        </h1>
      </div>

      {forApproval ? (
        <Alert tone="info">
          <ShieldCheck aria-hidden />
          <span>
            <b>{t("employees.form.waitBanner.title")}</b> {t("employees.form.waitBanner.text")}
          </span>
        </Alert>
      ) : null}
      {topError ? (
        <Alert tone="danger">
          <span>{describeError(topError, t)}</span>
        </Alert>
      ) : null}

      <form onSubmit={submit} noValidate>
        <Card>
          <CardHeader>
            <CardTitle>{t("employees.form.person")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
              <Field
                id="employee-code"
                label={t("employees.columns.code")}
                hint={editing ? t("employees.form.codeLocked") : t("employees.form.codeHint")}
                error={errors.employee_code}
              >
                <Input
                  id="employee-code"
                  value={values.employee_code}
                  disabled={editing}
                  maxLength={12}
                  autoComplete="off"
                  className="code uppercase"
                  aria-invalid={Boolean(errors.employee_code)}
                  onChange={(event) => set("employee_code", event.target.value)}
                />
              </Field>
              <Field id="full-name" label={t("employees.form.fullName")} error={errors.full_name}>
                <Input
                  id="full-name"
                  value={values.full_name}
                  maxLength={120}
                  autoComplete="off"
                  aria-invalid={Boolean(errors.full_name)}
                  onChange={(event) => set("full_name", event.target.value)}
                />
              </Field>
            </div>

            <fieldset>
              <legend className="mb-1.5 text-sm font-semibold">{t("employees.form.type")}</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {(["permanent", "temporary"] as const).map((kind) => (
                  <label
                    key={kind}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-lg border p-3",
                      values.type === kind && "border-primary bg-primary-soft",
                    )}
                  >
                    <input
                      type="radio"
                      name="employee-type"
                      value={kind}
                      checked={values.type === kind}
                      onChange={() => set("type", kind)}
                      className="mt-1 size-4"
                    />
                    <span>
                      <span className="flex items-center gap-1.5 font-bold">
                        {kind === "permanent" ? (
                          <ScanFace className="size-4" aria-hidden />
                        ) : (
                          <QrCode className="size-4" aria-hidden />
                        )}
                        {t(`employees.type.${kind}`)}
                      </span>
                      <span className="block text-[13px] text-muted-foreground">
                        {t(`employees.form.typeHint.${kind}`)}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              <p className="mt-1.5 text-[13px] text-muted-foreground">
                {t(`employees.form.punch.${values.type}`)}
              </p>
            </fieldset>
          </CardContent>
        </Card>

        <Card className="mt-5">
          <CardHeader>
            <CardTitle>{t("employees.form.work")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                id="plant"
                label={t("employees.columns.plant")}
                hint={editing ? t("employees.form.plantLocked") : undefined}
                error={errors.plant_id}
              >
                <Select
                  id="plant"
                  value={values.plant_id}
                  disabled={editing}
                  aria-invalid={Boolean(errors.plant_id)}
                  onChange={(event) => {
                    // Read the value now: inside the state updater below the select may
                    // already have been reset by React.
                    const chosenPlant = event.target.value;
                    setErrors((current) => ({ ...current, plant_id: undefined }));
                    // Categories, departments and shifts belong to one plant.
                    setValues((current) => ({
                      ...current,
                      plant_id: chosenPlant,
                      category_id: "",
                      department_id: "",
                      shift_id: "",
                    }));
                  }}
                >
                  <option value="">{t("employees.form.choosePlant")}</option>
                  {plantOptions.map((plant) => (
                    <option key={plant.id} value={plant.id}>
                      {plant.code} · {plant.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                id="category"
                label={t("employees.columns.category")}
                error={errors.category_id}
              >
                <Select
                  id="category"
                  value={values.category_id}
                  disabled={!plantId}
                  aria-invalid={Boolean(errors.category_id)}
                  onChange={(event) => set("category_id", event.target.value)}
                >
                  <option value="">{t("employees.form.chooseCategory")}</option>
                  {categories.data
                    ?.filter((item) => item.is_active || item.id === values.category_id)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                </Select>
              </Field>
              <Field
                id="department"
                label={t("employees.columns.department")}
                error={errors.department_id}
              >
                <Select
                  id="department"
                  value={values.department_id}
                  disabled={!plantId}
                  onChange={(event) => set("department_id", event.target.value)}
                >
                  <option value="">{t("employees.form.noDepartment")}</option>
                  {departments.data
                    ?.filter((item) => item.is_active || item.id === values.department_id)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                </Select>
              </Field>
              <Field id="shift" label={t("employees.columns.shift")} error={errors.shift_id}>
                <Select
                  id="shift"
                  value={values.shift_id}
                  disabled={!plantId}
                  aria-invalid={Boolean(errors.shift_id)}
                  onChange={(event) => set("shift_id", event.target.value)}
                >
                  <option value="">{t("employees.form.chooseShift")}</option>
                  {shifts.data
                    ?.filter((item) => item.is_active || item.id === values.shift_id)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} · {item.start_time.slice(0, 5)}–{item.end_time.slice(0, 5)}
                      </option>
                    ))}
                </Select>
              </Field>
              {shiftChanged ? (
                <Field
                  id="shift-from"
                  label={t("employees.form.shiftFrom")}
                  hint={t("employees.form.shiftFromHint")}
                >
                  <Input
                    id="shift-from"
                    type="date"
                    value={values.shift_from}
                    onChange={(event) => set("shift_from", event.target.value)}
                  />
                </Field>
              ) : null}
              <Field id="joined-on" label={t("employees.form.joinedOn")} error={errors.joined_on}>
                <Input
                  id="joined-on"
                  type="date"
                  value={values.joined_on}
                  aria-invalid={Boolean(errors.joined_on)}
                  onChange={(event) => set("joined_on", event.target.value)}
                />
              </Field>
            </div>
          </CardContent>
        </Card>

        <Card className="mt-5">
          <CardHeader>
            <CardTitle>{t("employees.form.pay")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            {temporary ? (
              <>
                <Field
                  id="contractor"
                  label={t("employees.columns.contractor")}
                  error={errors.contractor_id}
                >
                  <Select
                    id="contractor"
                    value={values.contractor_id}
                    onChange={(event) => set("contractor_id", event.target.value)}
                  >
                    <option value="">{t("employees.form.noContractor")}</option>
                    {contractors.data
                      ?.filter((item) => item.is_active || item.id === values.contractor_id)
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                  </Select>
                </Field>
                <Field
                  id="hourly-rate"
                  label={t("employees.form.hourlyRate")}
                  hint={t("employees.form.rupeesPerHour")}
                  error={errors.hourly_rate}
                >
                  <Input
                    id="hourly-rate"
                    inputMode="decimal"
                    value={values.hourly_rate}
                    className="tnum"
                    aria-invalid={Boolean(errors.hourly_rate)}
                    onChange={(event) => set("hourly_rate", event.target.value)}
                  />
                </Field>
              </>
            ) : null}
            <Field
              id="ot-rate"
              label={t("employees.form.otRate")}
              hint={t("employees.form.otRateHint")}
              error={errors.ot_rate_per_hour}
            >
              <Input
                id="ot-rate"
                inputMode="decimal"
                value={values.ot_rate_per_hour}
                className="tnum"
                aria-invalid={Boolean(errors.ot_rate_per_hour)}
                onChange={(event) => set("ot_rate_per_hour", event.target.value)}
              />
            </Field>
          </CardContent>
        </Card>

        {editing ? (
          <Card className="mt-5">
            <CardContent className="pt-5">
              <Field
                id="edit-reason"
                label={t("employees.form.reason")}
                hint={t("common.reasonExplain")}
              >
                <Textarea
                  id="edit-reason"
                  rows={2}
                  value={values.reason}
                  onChange={(event) => set("reason", event.target.value)}
                />
              </Field>
            </CardContent>
          </Card>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => navigate(-1)}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {forApproval ? t("employees.sendForApproval") : t("common.save")}
          </Button>
        </div>
      </form>
    </div>
  );
}
