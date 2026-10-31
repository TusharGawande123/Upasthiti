// Settings screen (spec §4.15, M3 §4.12): every rule value with its default and range, in groups.
// Only the Super Admin can change values; settings used from a later milestone are locked.
// The face settings are shown in five sub-groups with the accuracy report's value beside each
// threshold, and the privacy texts (company address, privacy contact) have their own card
// (design gate C, decision 0020).
import {
  ChevronDown,
  Gauge,
  Image,
  Info,
  Keyboard,
  Lightbulb,
  Loader2,
  Mail,
  MailX,
  ScanFace,
  Send,
  ShieldCheck,
  TriangleAlert,
  UserRound,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { describeError } from "@/features/auth/error-message";
import { useMe } from "@/features/auth/use-auth";
import { usePreferences, useSendTestEmail } from "@/features/notifications/use-notifications";
import { ReasonDialog } from "@/features/users/user-dialogs";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { FACE_SUBGROUPS, type FaceSubgroupId, floorIsAboveThreshold } from "./face-settings";
import { isValid, SettingRow, sameValue } from "./setting-row";
import { type Setting, type SettingValue, useSaveSettings, useSettings } from "./use-settings";

// The order of the cards on the screen.
const GROUP_ORDER = [
  "attendance",
  "alerts",
  "kiosk",
  "security",
  "punch",
  "antiproxy",
  "offline",
  "snapshots",
  "cards",
  "kiosk_screen",
  "face",
  "privacy",
  "salary",
];

const SUBGROUP_ICONS = {
  matching: Gauge,
  liveness: ShieldCheck,
  quality: Image,
  code: Keyboard,
  hints: Lightbulb,
} as const;

type RowProps = {
  drafts: Record<string, string>;
  canEdit: boolean;
  onChange: (key: string, value: string) => void;
};

function draftOf(setting: Setting, drafts: Record<string, string>) {
  return drafts[setting.key] ?? String(setting.value ?? "");
}

function isChanged(setting: Setting, drafts: Record<string, string>) {
  return (
    setting.editable &&
    drafts[setting.key] !== undefined &&
    !sameValue(drafts[setting.key] ?? null, setting.value)
  );
}

function Rows({
  settings,
  all,
  drafts,
  canEdit,
  onChange,
}: RowProps & { settings: Setting[]; all: Setting[] }) {
  const matchThreshold = all.find((setting) => setting.key === "face_match_threshold");
  return (
    <>
      {settings.map((setting) => (
        <SettingRow
          key={setting.key}
          setting={setting}
          draft={draftOf(setting, drafts)}
          changed={isChanged(setting, drafts)}
          canEdit={canEdit}
          floorError={
            setting.key === "face_code_offer_floor" &&
            matchThreshold !== undefined &&
            floorIsAboveThreshold(draftOf(setting, drafts), draftOf(matchThreshold, drafts))
          }
          onChange={(value) => onChange(setting.key, value)}
        />
      ))}
    </>
  );
}

// One of the five face sub-groups. On a phone it folds up (Matching is open, the others are
// closed, one with a change opens itself); from 768 px every sub-group is open, because looking
// down a list is faster than clicking.
function FaceSubgroup({
  id,
  settings,
  all,
  drafts,
  canEdit,
  onChange,
}: RowProps & { id: FaceSubgroupId; settings: Setting[]; all: Setting[] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(id === "matching");
  const changes = settings.filter((setting) => isChanged(setting, drafts)).length;
  const shown = open || changes > 0;
  const Icon = SUBGROUP_ICONS[id];
  return (
    <section className="border-t first:border-t-0">
      <button
        type="button"
        aria-expanded={shown}
        onClick={() => setOpen(!shown)}
        className="flex min-h-[52px] w-full items-center gap-3 px-1 py-2 text-left md:pointer-events-none"
      >
        <Icon className="size-5 shrink-0 text-primary" aria-hidden />
        <span className="flex-1">
          <span className="block text-sm font-bold">{t(`settings.subgroups.${id}`)}</span>
          <span className="block text-xs text-muted-foreground">
            {t("settings.settingsCount", { count: settings.length })}
          </span>
        </span>
        {changes > 0 ? (
          <span className="rounded-full bg-primary-soft px-2 py-0.5 text-xs font-semibold text-primary">
            {t("settings.changesCount", { count: changes })}
          </span>
        ) : null}
        <ChevronDown
          className={cn("size-5 shrink-0 transition md:hidden", shown && "rotate-180")}
          aria-hidden
        />
      </button>
      <div className={cn("pb-1", shown ? "block" : "hidden md:block")}>
        <Rows settings={settings} all={all} drafts={drafts} canEdit={canEdit} onChange={onChange} />
      </div>
    </section>
  );
}

function FaceCard({ all, drafts, canEdit, onChange }: RowProps & { all: Setting[] }) {
  const { t } = useTranslation();
  const faceSettings = all.filter((setting) => setting.group === "face");
  const hasReport = faceSettings.some((setting) => (setting.report_value ?? null) !== null);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ScanFace className="size-5 text-primary" aria-hidden />
          {t("settings.groups.face.title")}
        </CardTitle>
        <CardDescription>{t("settings.groups.face.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <p
          className={cn(
            "mb-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-[13px]",
            hasReport ? "border-primary/30 bg-primary-soft" : "border-dashed text-muted-foreground",
          )}
        >
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          {hasReport ? t("settings.reportStrip.found") : t("settings.reportStrip.none")}
        </p>
        {FACE_SUBGROUPS.map((subgroup) => {
          const rows = subgroup.keys
            .map((key) => faceSettings.find((setting) => setting.key === key))
            .filter((setting): setting is Setting => setting !== undefined);
          return (
            <FaceSubgroup
              key={subgroup.id}
              id={subgroup.id}
              settings={rows}
              all={all}
              drafts={drafts}
              canEdit={canEdit}
              onChange={onChange}
            />
          );
        })}
        <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Info className="size-4 shrink-0" aria-hidden />
          {t("settings.faceNote")}
        </p>
      </CardContent>
    </Card>
  );
}

// The two texts the consent text and the public privacy page print. The preview shows how the
// consent sentence will read; an empty value shows in red so it is not forgotten.
function PrivacyCard({
  all,
  drafts,
  canEdit,
  onChange,
  highlight,
}: RowProps & { all: Setting[]; highlight: boolean }) {
  const { t } = useTranslation();
  const rows = all.filter((setting) => setting.group === "privacy");
  const address = rows.find((setting) => setting.key === "company_address");
  const contact = rows.find((setting) => setting.key === "privacy_contact");
  const addressText = address ? draftOf(address, drafts).trim() : "";
  const contactText = contact ? draftOf(contact, drafts).trim() : "";
  const missing = (text: string, key: string) => (
    <mark
      className={cn(
        "rounded px-1",
        text ? "bg-warning-soft" : "bg-destructive/10 text-destructive",
      )}
    >
      {text || t(key)}
    </mark>
  );
  return (
    <Card id="privacy" className={cn(highlight && "ring-2 ring-primary")}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserRound className="size-5 text-primary" aria-hidden />
          {t("settings.groups.privacy.title")}
          {!addressText || !contactText ? (
            <span className="rounded-full bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning">
              {t("settings.privacy.notSet")}
            </span>
          ) : null}
        </CardTitle>
        <CardDescription>{t("settings.groups.privacy.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        {!addressText || !contactText ? (
          <p
            role="note"
            className="mb-3 flex items-start gap-2 rounded-lg border border-dashed border-warning bg-warning-soft px-3 py-2 text-[13px] text-warning"
          >
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              <b>{t("settings.privacy.setFirst")}</b> {t("settings.privacy.setFirstWhy")}
            </span>
          </p>
        ) : null}
        <Rows settings={rows} all={all} drafts={drafts} canEdit={canEdit} onChange={onChange} />
        <div className="mt-3 rounded-lg border bg-muted/40 p-3 text-[13px]">
          <p className="mb-1 text-xs font-bold tracking-wide text-muted-foreground uppercase">
            {t("settings.privacy.previewTitle")}
          </p>
          <p>
            {t("settings.privacy.previewStart")}
            {missing(addressText, "settings.privacy.addressMissing")}
            {t("settings.privacy.previewMiddle")}
            {missing(contactText, "settings.privacy.contactMissing")}
            {t("settings.privacy.previewEnd")}
          </p>
        </div>
        <p className="mt-3 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <Info className="size-4 shrink-0" aria-hidden />
          {t("settings.privacy.footer")}{" "}
          <Link to="/privacy" className="font-semibold text-primary underline">
            /privacy
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}

// The three lines the attendance device may show under a punch (spec M5 §4.16). Each has a dark
// preview of the exact line, so the Super Admin sees what the worker will see.
const GATE_LINES = [
  { key: "kiosk_show_inside_count", preview: "settings.gate.inside" },
  { key: "kiosk_late_hint", preview: "settings.gate.late" },
  { key: "kiosk_show_month_line", preview: "settings.gate.month" },
] as const;
const GATE_LINE_KEYS: string[] = GATE_LINES.map((line) => line.key);

function NewBadge() {
  const { t } = useTranslation();
  return (
    <span className="rounded-full bg-primary-soft px-2 py-0.5 text-xs font-semibold text-primary">
      {t("settings.newBadge")}
    </span>
  );
}

function GateLinesCard({ all, drafts, canEdit, onChange }: RowProps & { all: Setting[] }) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {t("settings.groups.gate_lines.title")}
          <NewBadge />
        </CardTitle>
        <CardDescription>{t("settings.groups.gate_lines.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        {GATE_LINES.map(({ key, preview }) => {
          const setting = all.find((item) => item.key === key);
          if (!setting) return null;
          const isOn = draftOf(setting, drafts) === "on";
          return (
            <div key={key} className="border-b last:border-0">
              <Rows
                settings={[setting]}
                all={all}
                drafts={drafts}
                canEdit={canEdit}
                onChange={onChange}
              />
              <p className="mb-2 rounded-lg bg-foreground px-3 py-2 text-sm font-semibold text-background">
                <span className="mr-2 text-xs font-normal opacity-75">
                  {t("settings.gate.previewLabel")}
                </span>
                {t(preview)}
              </p>
              <p className="mb-3 text-xs text-muted-foreground">{t("settings.gate.neverSpoken")}</p>
              {key === "kiosk_show_month_line" && isOn ? (
                <p
                  role="note"
                  className="mb-3 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-[13px] text-warning"
                >
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                  {t("settings.gate.monthWarning")}
                </p>
              ) : null}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// The alerts card. The email switch is shown only when the server has email settings (otherwise
// it would do nothing); the Super Admin can then send a test email to themselves.
function AlertsCard({ all, drafts, canEdit, onChange }: RowProps & { all: Setting[] }) {
  const { t } = useTranslation();
  const preferences = usePreferences();
  const testEmail = useSendTestEmail();
  const emailMissing = preferences.data?.email_configured === false;
  const rows = all.filter(
    (setting) => setting.group === "alerts" && !(emailMissing && setting.key === "email_alerts"),
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {t("settings.groups.alerts.title")}
          <NewBadge />
        </CardTitle>
        <CardDescription>{t("settings.groups.alerts.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <Rows settings={rows} all={all} drafts={drafts} canEdit={canEdit} onChange={onChange} />
        {emailMissing ? (
          <p className="mt-3 flex items-start gap-3 rounded-lg border border-dashed bg-muted/40 p-3 text-sm">
            <MailX className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
            <span>
              <b className="block">{t("notifications.emailNotSetUp.title")}</b>
              {t("notifications.emailNotSetUp.body")}
            </span>
          </p>
        ) : null}
        {preferences.data?.email_configured && canEdit ? (
          <div className="mt-3 space-y-2">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Mail className="size-4" aria-hidden />
              {t("settings.email.ready")}
            </p>
            <Button
              variant="outline"
              disabled={testEmail.isPending}
              onClick={() =>
                testEmail.mutate(undefined, {
                  onSuccess: () => toast.success(t("settings.email.testSent")),
                })
              }
            >
              <Send aria-hidden />
              {t("settings.email.sendTest")}
            </Button>
            {testEmail.isError ? (
              <p role="alert" className="text-[13px] font-medium text-destructive">
                {describeError(testEmail.error, t)}
              </p>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

// A day window that does not fit the longest shift is refused by the server; say it in plain
// words with the real numbers (the server sends the longest shift in minutes).
function describeSaveError(error: unknown, t: ReturnType<typeof useTranslation>["t"]): string {
  if (error instanceof ApiError && error.code === "SETTING_INVALID") {
    const longest = Number(error.details?.longest_shift_min);
    if (Number.isFinite(longest) && error.details?.key === "attendance_window_before_hours") {
      const hours = Math.round((longest / 60) * 10) / 10;
      return t("settings.windowError", { longest: hours, max: Math.round((24 - hours) * 10) / 10 });
    }
  }
  return describeError(error, t);
}

// The list of changes in the reason dialog: what each setting was and will be (small extra).
function ChangesList({ changed, drafts }: { changed: Setting[]; drafts: Record<string, string> }) {
  const { t } = useTranslation();
  return (
    <ul className="space-y-1 rounded-lg border bg-muted/40 p-3 text-[13px]">
      {changed.map((setting) => (
        <li key={setting.key} className="flex flex-wrap gap-x-2">
          <span className="font-semibold">{t(`settings.items.${setting.key}.label`)}:</span>
          <span className="text-muted-foreground">
            {setting.is_text ? t("settings.textChanged") : String(setting.value)}
          </span>
          {setting.is_text ? null : (
            <>
              <span aria-hidden>→</span>
              <span className="sr-only">{t("settings.changedTo")}</span>
              <span className="tnum font-semibold">{drafts[setting.key]}</span>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

export function SettingsPage() {
  const { t } = useTranslation();
  const me = useMe();
  const settings = useSettings();
  const save = useSaveSettings();
  const location = useLocation();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [askingReason, setAskingReason] = useState(false);
  const canEdit = me.data?.role === "super_admin";
  const fromConsent = (location.state as { fromConsent?: { name: string; path: string } } | null)
    ?.fromConsent;
  const toPrivacy = location.hash === "#privacy";

  // Coming from the consent dialog: bring the privacy card into view.
  useEffect(() => {
    if (toPrivacy && settings.isSuccess) {
      document.getElementById("privacy")?.scrollIntoView({ block: "start" });
    }
  }, [toPrivacy, settings.isSuccess]);

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
  const changed = all.filter((setting) => isChanged(setting, drafts));
  const matchThreshold = all.find((setting) => setting.key === "face_match_threshold");
  const floor = all.find((setting) => setting.key === "face_code_offer_floor");
  const floorWrong =
    matchThreshold !== undefined &&
    floor !== undefined &&
    floorIsAboveThreshold(draftOf(floor, drafts), draftOf(matchThreshold, drafts));
  const anyInvalid =
    floorWrong || changed.some((setting) => !isValid(setting, drafts[setting.key] ?? ""));
  const onChange = (key: string, value: string) =>
    setDrafts((current) => ({ ...current, [key]: value }));

  const confirmSave = (reason: string) => {
    const values: Record<string, SettingValue> = {};
    for (const setting of changed) {
      const raw = drafts[setting.key] as string;
      // A fixed choice keeps its own kind (the text "on", the number 26); text stays text;
      // the others are numbers.
      values[setting.key] = setting.is_text
        ? raw.trim()
        : setting.allowed_values
          ? (setting.allowed_values.find((value) => String(value) === raw) ?? raw)
          : Number(raw);
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

  const shared = { drafts, canEdit, onChange };
  return (
    <div className="mx-auto max-w-4xl space-y-5 pb-24">
      <div>
        <h1 className="text-[26px] font-bold tracking-tight">{t("settings.title")}</h1>
        <p className="text-sm text-muted-foreground">
          {canEdit ? t("settings.subtitleEdit") : t("settings.subtitleReadOnly")}
        </p>
      </div>

      {fromConsent ? (
        <Alert tone="info" className="items-center">
          <span>{t("settings.fromConsent", { name: fromConsent.name })}</span>
          <Link to={fromConsent.path} className="ml-auto font-semibold underline">
            {t("settings.backTo", { name: fromConsent.name })}
          </Link>
        </Alert>
      ) : null}

      {GROUP_ORDER.map((group) => {
        const rows = all.filter((setting) => setting.group === group);
        if (rows.length === 0) return null;
        if (group === "face") return <FaceCard key={group} all={all} {...shared} />;
        if (group === "alerts") return <AlertsCard key={group} all={all} {...shared} />;
        if (group === "kiosk_screen") {
          const screenRows = rows.filter((setting) => !GATE_LINE_KEYS.includes(setting.key));
          return (
            <div key={group} className="space-y-5">
              <Card>
                <CardHeader>
                  <CardTitle>{t("settings.groups.kiosk_screen.title")}</CardTitle>
                  <CardDescription>{t("settings.groups.kiosk_screen.description")}</CardDescription>
                </CardHeader>
                <CardContent>
                  <Rows settings={screenRows} all={all} {...shared} />
                </CardContent>
              </Card>
              <GateLinesCard all={all} {...shared} />
            </div>
          );
        }
        if (group === "privacy") {
          return <PrivacyCard key={group} all={all} highlight={toPrivacy} {...shared} />;
        }
        return (
          <Card key={group}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                {t(`settings.groups.${group}.title`)}
                {group === "attendance" ? <NewBadge /> : null}
              </CardTitle>
              <CardDescription>{t(`settings.groups.${group}.description`)}</CardDescription>
            </CardHeader>
            <CardContent>
              <Rows settings={rows} all={all} {...shared} />
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
        error={save.error ? describeSaveError(save.error, t) : undefined}
        details={<ChangesList changed={changed} drafts={drafts} />}
        onConfirm={confirmSave}
      />
      {save.isPending ? <Loader2 className="sr-only animate-spin" /> : null}
    </div>
  );
}
