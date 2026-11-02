// Notifications (/admin/notifications, spec M5 §4.13 and §5.7, design gate C screen 7): every alert
// for the plants the user may see, newest first, with a kind filter, unread / all, "Mark all as
// read" and the own email alerts. The bell in the top bar shows the newest.
import { CheckCheck, Mail, MailX, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { describeError } from "@/features/auth/error-message";
import { type Me, useMe } from "@/features/auth/use-auth";
import { cn } from "@/lib/utils";
import { NotificationRow } from "./notification-row";
import {
  KINDS,
  type NotificationItem,
  useMarkAllRead,
  useMarkRead,
  useNotifications,
  usePreferences,
  useSavePreferences,
} from "./use-notifications";

const STEP = 25;
const MAX_PAGE_SIZE = 200;

// What each role can receive: the server limits the list the same way, this only keeps the
// email switches and the kind filter honest.
const HEAD_KINDS = [
  "still_inside",
  "device_offline",
  "many_rejections",
  "incomplete_days",
  "absence_streak",
  "monthly_register",
  "correction_decided",
];

function kindsFor(role: Me["role"] | undefined): readonly string[] {
  return role === "super_admin" ? KINDS : HEAD_KINDS;
}

function Switch({
  on,
  label,
  disabled,
  onChange,
}: {
  on: boolean;
  label: string;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className="flex h-11 shrink-0 cursor-pointer items-center gap-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
    >
      <span
        aria-hidden
        className={cn(
          "flex h-8 w-14 items-center rounded-full p-1",
          on ? "bg-primary" : "bg-border-strong",
        )}
      >
        <span
          className={cn("size-6 rounded-full bg-white transition-transform", on && "translate-x-6")}
        />
      </span>
      <span className="w-8">{on ? t("notifications.email.on") : t("notifications.email.off")}</span>
    </button>
  );
}

/** "My email alerts": the user's own switches. Hidden (with a note) when the server has no email. */
function EmailCard({ role }: { role: Me["role"] | undefined }) {
  const { t } = useTranslation();
  const preferences = usePreferences();
  const save = useSavePreferences();
  const [draft, setDraft] = useState<{ enabled: boolean; kinds: string[] } | null>(null);

  if (preferences.isPending) return <Skeleton className="h-16" />;
  if (preferences.isError) return null;
  const data = preferences.data;
  if (!data.email_configured) {
    return (
      <p className="flex items-start gap-3 rounded-lg border border-dashed bg-muted/40 p-3 text-sm">
        <MailX className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
        <span>
          <b className="block">{t("notifications.emailNotSetUp.title")}</b>
          {t("notifications.emailNotSetUp.body")}
        </span>
      </p>
    );
  }

  const current = draft ?? { enabled: data.email_enabled, kinds: data.email_kinds };
  const changed = draft !== null;
  const toggleKind = (kind: string, on: boolean) =>
    setDraft({
      ...current,
      kinds: on ? [...current.kinds, kind] : current.kinds.filter((value) => value !== kind),
    });

  return (
    <Card className="space-y-3 p-4">
      <h2 className="flex items-center gap-2 text-base font-bold">
        <Mail className="size-5 text-primary" aria-hidden />
        {t("notifications.email.title")}
      </h2>
      <p className="text-sm text-muted-foreground">
        {data.has_email ? t("notifications.email.intro") : t("notifications.email.noAddress")}
      </p>
      <div className="flex items-center justify-between gap-3 border-t pt-3">
        <span className="text-sm font-semibold">{t("notifications.email.master")}</span>
        <Switch
          on={current.enabled}
          label={t("notifications.email.master")}
          disabled={!data.has_email}
          onChange={(next) => setDraft({ ...current, enabled: next })}
        />
      </div>
      {current.enabled ? (
        <ul className="divide-y rounded-lg border">
          {kindsFor(role).map((kind) => (
            <li key={kind} className="flex items-center justify-between gap-3 px-3">
              <span className="text-sm">
                {kind === "monthly_register"
                  ? t("notifications.email.registerByEmail")
                  : t(`notifications.kind.${kind}`)}
              </span>
              <Switch
                on={current.kinds.includes(kind)}
                label={t(`notifications.kind.${kind}`)}
                onChange={(next) => toggleKind(kind, next)}
              />
            </li>
          ))}
        </ul>
      ) : null}
      {save.isError ? (
        <Alert tone="danger">
          <span>{describeError(save.error, t)}</span>
        </Alert>
      ) : null}
      <div className="flex justify-end">
        <Button
          disabled={!changed || save.isPending}
          onClick={() =>
            save.mutate(
              { email_enabled: current.enabled, email_kinds: current.kinds },
              {
                onSuccess: () => {
                  setDraft(null);
                  toast.success(t("notifications.email.saved"));
                },
              },
            )
          }
        >
          {t("notifications.email.save")}
        </Button>
      </div>
    </Card>
  );
}

export function NotificationsPage() {
  const { t } = useTranslation();
  const me = useMe();
  const [kind, setKind] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [pageSize, setPageSize] = useState(STEP);
  const list = useNotifications({
    kind: kind || undefined,
    unread: unreadOnly,
    page: 1,
    page_size: pageSize,
  });
  const unreadList = useNotifications({ unread: true, page: 1, page_size: 1 });
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();

  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const unreadTotal = unreadList.data?.total ?? 0;
  const filtering = kind !== "" || unreadOnly;

  const open = (item: NotificationItem) => {
    if (!item.read) markRead.mutate(item.id);
  };
  const clearFilters = () => {
    setKind("");
    setUnreadOnly(false);
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">{t("notifications.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("notifications.subtitle")}</p>
        </div>
        <Button
          variant="outline"
          disabled={unreadTotal === 0 || markAll.isPending}
          onClick={() => markAll.mutate()}
        >
          <CheckCheck aria-hidden />
          {t("notifications.markAll")}
        </Button>
      </div>

      <EmailCard role={me.data?.role} />

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b p-4">
          <Select
            aria-label={t("notifications.filter.kindLabel")}
            value={kind}
            onChange={(event) => setKind(event.target.value)}
            className="w-auto min-w-44"
          >
            <option value="">{t("notifications.filter.kind")}</option>
            {kindsFor(me.data?.role).map((value) => (
              <option key={value} value={value}>
                {t(`notifications.kind.${value}`)}
              </option>
            ))}
          </Select>
          <fieldset className="m-0 flex items-center gap-2 border-0 p-0">
            <legend className="float-left mr-2 text-xs font-bold tracking-wide text-muted-foreground uppercase">
              {t("notifications.filter.show")}
            </legend>
            <button
              type="button"
              aria-pressed={!unreadOnly}
              onClick={() => setUnreadOnly(false)}
              className={cn(
                "h-11 cursor-pointer rounded-full border px-4 text-sm font-semibold",
                !unreadOnly
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-card hover:bg-muted",
              )}
            >
              {t("notifications.filter.all")}
            </button>
            <button
              type="button"
              aria-pressed={unreadOnly}
              onClick={() => setUnreadOnly(true)}
              className={cn(
                "h-11 cursor-pointer rounded-full border px-4 text-sm font-semibold",
                unreadOnly
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-card hover:bg-muted",
              )}
            >
              {t("notifications.unread")} <span className="tnum">{unreadTotal}</span>
            </button>
          </fieldset>
        </div>

        {list.isPending ? (
          <div className="space-y-2 p-4" aria-busy="true">
            {["a", "b", "c", "d"].map((id) => (
              <Skeleton key={id} className="h-20" />
            ))}
          </div>
        ) : list.isError ? (
          <div role="alert" className="space-y-2 p-6">
            <p className="font-bold">{t("notifications.error.title")}</p>
            <p className="text-sm text-muted-foreground">{describeError(list.error, t)}</p>
            <Button variant="outline" size="sm" onClick={() => list.refetch()}>
              {t("dashboard.live.tryAgain")}
            </Button>
          </div>
        ) : items.length === 0 ? (
          <div className="space-y-2 p-6">
            <p className="text-lg font-bold">
              {filtering
                ? t("notifications.empty.filterTitle")
                : t("notifications.empty.pageTitle")}
            </p>
            <p className="text-sm text-muted-foreground">
              {filtering ? t("notifications.empty.filterBody") : t("notifications.empty.bellBody")}
            </p>
            {filtering ? (
              <Button variant="outline" size="sm" onClick={clearFilters}>
                {t("notifications.filter.clear")}
              </Button>
            ) : null}
          </div>
        ) : (
          <ul className="divide-y">
            {items.map((item) => (
              <NotificationRow key={item.id} item={item} onOpen={open} />
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t p-3 text-[13px] text-muted-foreground">
          <span className="flex items-center gap-2">
            <ShieldCheck className="size-4" aria-hidden />
            {t("notifications.footer", { count: total })}
          </span>
          {items.length < total && pageSize < MAX_PAGE_SIZE ? (
            <Button variant="outline" size="sm" onClick={() => setPageSize(pageSize + STEP)}>
              {t("notifications.showMore")}
            </Button>
          ) : (
            <span>{t("notifications.newestFirst")}</span>
          )}
        </div>
      </Card>
    </div>
  );
}
