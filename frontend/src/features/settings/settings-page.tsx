// Settings screen (spec §4.15): every rule value with its default and range, in groups.
// Only the Super Admin can change values; settings used from a later milestone are locked.
import { Loader2, Lock, RotateCcw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { describeError } from "@/features/auth/error-message";
import { useMe } from "@/features/auth/use-auth";
import { ReasonDialog } from "@/features/users/user-dialogs";
import { type Setting, type SettingValue, useSaveSettings, useSettings } from "./use-settings";

// The order of the cards on the screen.
const GROUP_ORDER = ["kiosk", "security", "punch", "snapshots", "face", "salary"];

function sameValue(a: SettingValue, b: SettingValue) {
  return String(a) === String(b);
}

function SettingRow({
  setting,
  draft,
  canEdit,
  onChange,
}: {
  setting: Setting;
  draft: string;
  canEdit: boolean;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  // The server sends the unit as a short code ("min", "m"); the words come from our texts.
  const unitLabel = (unit: string | null) =>
    unit ? t(`settings.units.${unit}`, { defaultValue: unit }) : "";
  const locked = !setting.editable || !canEdit;
  const hasRange = setting.minimum !== null && setting.maximum !== null;
  const numeric = Number(draft);
  const outOfRange =
    !locked &&
    hasRange &&
    draft !== "" &&
    (Number.isNaN(numeric) ||
      numeric < (setting.minimum as number) ||
      numeric > (setting.maximum as number));

  return (
    <div className="grid gap-2 border-b py-4 last:border-0 sm:grid-cols-[1fr_220px] sm:items-start">
      <div>
        <label htmlFor={setting.key} className="text-sm font-semibold">
          {t(`settings.items.${setting.key}.label`)}
        </label>
        <p className="text-[13px] text-muted-foreground">
          {t(`settings.items.${setting.key}.help`)}
        </p>
        <p className="mt-1 text-xs text-subtle-foreground">
          {t("settings.defaultIs", {
            value:
              setting.default === null
                ? t("settings.setLater")
                : `${setting.default} ${unitLabel(setting.unit)}`,
          })}
          {hasRange
            ? ` · ${t("settings.range", { min: setting.minimum, max: setting.maximum })}`
            : ""}
        </p>
        {!setting.editable ? (
          <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-warning">
            <Lock className="size-3" aria-hidden />
            {t("settings.usedFrom", { milestone: setting.used_from })}
          </p>
        ) : null}
      </div>
      <div>
        <div className="flex items-center gap-2">
          <Input
            id={setting.key}
            value={draft}
            readOnly={locked}
            inputMode="numeric"
            aria-invalid={outOfRange}
            className="tnum"
            onChange={(event) => onChange(event.target.value)}
          />
          <span className="min-w-10 shrink-0 text-[13px] text-muted-foreground">
            {unitLabel(setting.unit)}
          </span>
        </div>
        {outOfRange ? (
          <p className="mt-1 text-[13px] font-medium text-destructive">
            {t("settings.outOfRange", { min: setting.minimum, max: setting.maximum })}
          </p>
        ) : null}
        {!locked && setting.default !== null && !sameValue(draft, setting.default) ? (
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

export function SettingsPage() {
  const { t } = useTranslation();
  const me = useMe();
  const settings = useSettings();
  const save = useSaveSettings();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [askingReason, setAskingReason] = useState(false);
  const canEdit = me.data?.role === "super_admin";

  if (settings.isPending) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (settings.isError) {
    return (
      <Alert tone="danger" className="mx-auto max-w-4xl">
        <span>{describeError(settings.error, t)}</span>
      </Alert>
    );
  }

  const all = settings.data.settings;
  const draftOf = (setting: Setting) => drafts[setting.key] ?? String(setting.value ?? "");
  const changed = all.filter(
    (setting) =>
      setting.editable &&
      drafts[setting.key] !== undefined &&
      !sameValue(drafts[setting.key] ?? null, setting.value),
  );
  const anyInvalid = changed.some((setting) => {
    const value = Number(drafts[setting.key]);
    return (
      Number.isNaN(value) ||
      (setting.minimum !== null && value < setting.minimum) ||
      (setting.maximum !== null && value > setting.maximum)
    );
  });

  const confirmSave = (reason: string) => {
    const values: Record<string, SettingValue> = {};
    for (const setting of changed) {
      const raw = drafts[setting.key] as string;
      values[setting.key] = setting.allowed_values && raw === "actual" ? raw : Number(raw);
    }
    save.mutate(
      { values, reason },
      {
        onSuccess: () => {
          setDrafts({});
          setAskingReason(false);
          toast.success(t("settings.saved"));
        },
      },
    );
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5 pb-24">
      <div>
        <h1 className="text-[26px] font-bold tracking-tight">{t("settings.title")}</h1>
        <p className="text-sm text-muted-foreground">
          {canEdit ? t("settings.subtitleEdit") : t("settings.subtitleReadOnly")}
        </p>
      </div>

      {GROUP_ORDER.map((group) => {
        const rows = all.filter((setting) => setting.group === group);
        if (rows.length === 0) return null;
        return (
          <Card key={group}>
            <CardHeader>
              <CardTitle>{t(`settings.groups.${group}.title`)}</CardTitle>
              <CardDescription>{t(`settings.groups.${group}.description`)}</CardDescription>
            </CardHeader>
            <CardContent>
              {rows.map((setting) => (
                <SettingRow
                  key={setting.key}
                  setting={setting}
                  draft={draftOf(setting)}
                  canEdit={canEdit}
                  onChange={(value) =>
                    setDrafts((current) => ({ ...current, [setting.key]: value }))
                  }
                />
              ))}
            </CardContent>
          </Card>
        );
      })}

      {changed.length > 0 ? (
        <div className="fixed right-0 bottom-0 left-0 z-20 border-t bg-card/95 px-5 py-3 backdrop-blur lg:left-16 xl:left-64">
          <div className="mx-auto flex max-w-4xl items-center justify-between gap-3">
            <p className="text-sm font-semibold">
              {t("settings.unsaved", { count: changed.length })}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setDrafts({})}>
                {t("settings.discard")}
              </Button>
              <Button disabled={anyInvalid} onClick={() => setAskingReason(true)}>
                {t("settings.save")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <ReasonDialog
        open={askingReason}
        onOpenChange={setAskingReason}
        title={t("settings.reasonTitle")}
        confirmLabel={t("settings.save")}
        isPending={save.isPending}
        error={save.error ? describeError(save.error, t) : undefined}
        onConfirm={confirmSave}
      />
      {save.isPending ? <Loader2 className="sr-only animate-spin" /> : null}
    </div>
  );
}
