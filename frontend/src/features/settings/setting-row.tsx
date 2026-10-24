// One row of the settings screen: the label, its help and range, and the input that fits the kind
// of setting (a number with its unit, a fixed choice, or free text). For the face settings it also
// shows the value suggested by the accuracy report and a warning when a threshold is lowered
// (spec M3 §4.12, design gate C).
import { FileCheck, Lock, RotateCcw, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { isThreshold, REPORT_KEYS } from "./face-settings";
import type { Setting, SettingValue } from "./use-settings";

export function sameValue(a: SettingValue, b: SettingValue) {
  return String(a) === String(b);
}

/** Whether a typed or chosen value is acceptable (the server checks it again). */
export function isValid(setting: Setting, raw: string): boolean {
  // A text setting has a length range (company address, privacy contact).
  if (setting.is_text) {
    const length = raw.trim().length;
    return (
      length >= (setting.minimum ?? 0) && (setting.maximum === null || length <= setting.maximum)
    );
  }
  // A setting with a fixed list of choices (on / off, 26 / 30 / actual) takes one of them.
  if (setting.allowed_values) return setting.allowed_values.some((value) => String(value) === raw);
  const value = Number(raw);
  return (
    raw !== "" &&
    !Number.isNaN(value) &&
    (setting.minimum === null || value >= setting.minimum) &&
    (setting.maximum === null || value <= setting.maximum)
  );
}

function ReportValue({
  setting,
  locked,
  onUse,
}: {
  setting: Setting;
  locked: boolean;
  onUse: (value: string) => void;
}) {
  const { t } = useTranslation();
  if (!REPORT_KEYS.has(setting.key)) return null;
  const suggested = setting.report_value ?? null;
  if (suggested === null) {
    return (
      <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border border-dashed px-2 py-0.5 text-xs text-muted-foreground">
        <FileCheck className="size-3.5" aria-hidden />
        {t("settings.noReport")}
      </p>
    );
  }
  return (
    <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
      <span className="inline-flex items-center gap-1.5 rounded-md bg-primary-soft px-2 py-0.5 font-semibold text-primary">
        <FileCheck className="size-3.5" aria-hidden />
        {t("settings.reportValue", { value: suggested })}
      </span>
      {!locked && !sameValue(String(suggested), String(setting.value ?? "")) ? (
        <button
          type="button"
          onClick={() => onUse(String(suggested))}
          className="font-semibold text-primary underline"
        >
          {t("settings.useReport", { value: suggested })}
        </button>
      ) : null}
    </p>
  );
}

export function SettingRow({
  setting,
  draft,
  changed,
  canEdit,
  floorError,
  onChange,
}: {
  setting: Setting;
  draft: string;
  changed: boolean;
  canEdit: boolean;
  /** The code-entry floor is above the match threshold (spec §7 rule 13). */
  floorError: boolean;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  // The server sends the unit as a short code ("min", "m"); the words come from our texts.
  const unitLabel = (unit: string | null) =>
    unit ? t(`settings.units.${unit}`, { defaultValue: unit }) : "";
  const locked = !setting.editable || !canEdit;
  const hasChoices = setting.allowed_values !== null && setting.editable;
  const hasRange = setting.minimum !== null && setting.maximum !== null;
  // Lowering the retention also shortens photos that are already stored (spec M2 §7 rule 4).
  const lowersRetention =
    setting.key === "snapshot_retention_days" &&
    !locked &&
    isValid(setting, draft) &&
    Number(draft) < Number(setting.value);
  // Lowering a face threshold lets more strangers through (spec M3 §4.12).
  const lowersThreshold =
    isThreshold(setting) &&
    !locked &&
    isValid(setting, draft) &&
    Number(draft) < Number(setting.value);
  const numeric = Number(draft);
  const outOfRange =
    !locked &&
    hasRange &&
    !setting.is_text &&
    draft !== "" &&
    (Number.isNaN(numeric) ||
      numeric < (setting.minimum as number) ||
      numeric > (setting.maximum as number));
  const textTooShort = !locked && setting.is_text && !isValid(setting, draft);

  return (
    <div
      className={`grid gap-2 border-b py-4 last:border-0 sm:items-start ${
        setting.is_text ? "" : "sm:grid-cols-[1fr_220px]"
      } ${changed ? "border-l-4 border-l-primary pl-3" : ""}`}
    >
      <div>
        <label htmlFor={setting.key} className="text-sm font-semibold">
          {t(`settings.items.${setting.key}.label`)}
        </label>
        {changed ? (
          <span className="ml-2 rounded-full bg-primary-soft px-2 py-0.5 text-xs font-semibold text-primary">
            {t("settings.changedBadge")}
          </span>
        ) : null}
        <p className="text-[13px] text-muted-foreground">
          {t(`settings.items.${setting.key}.help`)}
        </p>
        <p className="mt-1 text-xs text-subtle-foreground">
          {setting.is_text
            ? t("settings.textLength", { min: setting.minimum, max: setting.maximum })
            : t("settings.defaultIs", {
                value:
                  setting.default === null
                    ? t("settings.setLater")
                    : `${setting.default} ${unitLabel(setting.unit)}`,
              })}
          {hasRange && !setting.is_text
            ? ` · ${t("settings.range", { min: setting.minimum, max: setting.maximum })}`
            : ""}
        </p>
        <ReportValue setting={setting} locked={locked} onUse={onChange} />
        {!setting.editable ? (
          <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-warning">
            <Lock className="size-3" aria-hidden />
            {t("settings.usedFrom", { milestone: setting.used_from })}
          </p>
        ) : null}
      </div>
      <div>
        {setting.is_text ? (
          <>
            <Textarea
              id={setting.key}
              value={draft}
              readOnly={locked}
              rows={2}
              maxLength={setting.maximum ?? undefined}
              aria-invalid={textTooShort}
              onChange={(event) => onChange(event.target.value)}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {t("settings.counter", {
                count: draft.trim().length,
                max: setting.maximum,
                min: setting.minimum,
              })}
            </p>
          </>
        ) : (
          <div className="flex items-center gap-2">
            {hasChoices ? (
              <Select
                id={setting.key}
                value={draft}
                disabled={locked}
                onChange={(event) => onChange(event.target.value)}
              >
                {setting.allowed_values?.map((value) => (
                  <option key={String(value)} value={String(value)}>
                    {t(`settings.choices.${value}`, { defaultValue: String(value) })}
                  </option>
                ))}
              </Select>
            ) : (
              <>
                <Input
                  id={setting.key}
                  value={draft}
                  readOnly={locked}
                  inputMode="numeric"
                  aria-invalid={outOfRange || floorError}
                  aria-describedby={floorError ? `${setting.key}-floor` : undefined}
                  className="tnum"
                  onChange={(event) => onChange(event.target.value)}
                />
                <span className="min-w-10 shrink-0 text-[13px] text-muted-foreground">
                  {unitLabel(setting.unit)}
                </span>
              </>
            )}
          </div>
        )}
        {lowersRetention ? (
          <div
            role="alert"
            className="mt-2 flex items-start gap-2 rounded-md border border-warning/30 bg-warning-soft p-2 text-[13px] text-warning"
          >
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              <b>{t("settings.retentionWarning.title", { days: draft })}</b>{" "}
              {t("settings.retentionWarning.text", { days: draft, current: setting.value })}
            </span>
          </div>
        ) : null}
        {lowersThreshold ? (
          <div
            role="alert"
            className="mt-2 flex items-start gap-2 rounded-md border border-warning/30 bg-warning-soft p-2 text-[13px] text-warning"
          >
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              <b>{t("settings.lowerThreshold.title")}</b> {t("settings.lowerThreshold.text")}
            </span>
          </div>
        ) : null}
        {outOfRange ? (
          <p className="mt-1 text-[13px] font-medium text-destructive">
            {t("settings.outOfRange", { min: setting.minimum, max: setting.maximum })}
          </p>
        ) : null}
        {floorError ? (
          <p id={`${setting.key}-floor`} className="mt-1 text-[13px] font-medium text-destructive">
            {t("settings.floorError")}
          </p>
        ) : null}
        {!locked &&
        !setting.is_text &&
        setting.default !== null &&
        !sameValue(draft, setting.default) ? (
          <button
            type="button"
            onClick={() => onChange(String(setting.default))}
            className="mt-1 inline-flex items-center gap-1 text-[13px] font-semibold text-primary"
          >
            <RotateCcw className="size-3" aria-hidden />
            {t("settings.resetToDefault")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
