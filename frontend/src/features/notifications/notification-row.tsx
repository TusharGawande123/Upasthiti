// One notification, as shown in the bell panel and on the Notifications page (design gate C
// screen 7). The kind is an icon AND a word, unread is a word plus a blue bar, and an urgent alert
// that is still open has the word "Urgent", a siren and a red bar: never colour alone.
import {
  ArrowRight,
  Building2,
  CircleCheck,
  Clock,
  FilePenLine,
  FileSpreadsheet,
  Flag,
  type LucideIcon,
  ShieldAlert,
  Siren,
  UserX,
  WifiOff,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { formatDay } from "@/features/attendance/attendance-format";
import { formatDate, formatTime, todayIst } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { NotificationItem, NotificationKind } from "./use-notifications";

const KIND_ICONS: Record<NotificationKind, LucideIcon> = {
  still_inside: Siren,
  device_offline: WifiOff,
  many_rejections: ShieldAlert,
  incomplete_days: Clock,
  review_digest: Flag,
  correction_requested: FilePenLine,
  correction_decided: CircleCheck,
  absence_streak: UserX,
  monthly_register: FileSpreadsheet,
};

// The words of the action link under each text.
const LINK_WORDS: Record<NotificationKind, string> = {
  still_inside: "list",
  device_offline: "devices",
  many_rejections: "rejected",
  incomplete_days: "list",
  review_digest: "review",
  correction_requested: "request",
  correction_decided: "correction",
  absence_streak: "month",
  monthly_register: "register",
};

/** The values that fill the text: dates are written as DD/MM/YYYY, the rest comes as it is. */
export function textValues(item: NotificationItem): Record<string, string | number> {
  const values: Record<string, string | number> = { plant: item.plant?.code ?? "" };
  for (const [name, value] of Object.entries(item.params)) {
    if (value === null || value === undefined) continue;
    const isDay = (name === "date" || name === "since") && typeof value === "string";
    values[name] = isDay ? formatDay(value) : value;
  }
  return values;
}

export function notificationText(
  item: NotificationItem,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const values = textValues(item);
  // The server's key is "notification.<kind>"; our texts live under notifications.text.
  const kind = item.text_key.replace(/^notification\./, "");
  if (kind === "correction_decided") {
    return t(
      `notifications.text.correction_decided_${values.result === "rejected" ? "rejected" : "approved"}`,
      values,
    );
  }
  return t(`notifications.text.${kind}`, values);
}

/** "19:05" today, "Yesterday 17:40", otherwise the date (all in IST). */
export function whenText(
  moment: string,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(
    new Date(moment),
  );
  const today = todayIst();
  const yesterday = new Date(`${today}T00:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  if (day === today) return formatTime(moment);
  if (day === yesterday.toISOString().slice(0, 10)) {
    return t("notifications.yesterday", { time: formatTime(moment) });
  }
  return formatDate(moment);
}

export function NotificationRow({
  item,
  onOpen,
}: {
  item: NotificationItem;
  /** Called when the link is chosen (marks it read, closes the bell panel). */
  onOpen: (item: NotificationItem) => void;
}) {
  const { t } = useTranslation();
  const Icon = KIND_ICONS[item.kind] ?? Flag;
  const urgent = item.severity === "urgent" && item.resolved_at === null;
  const text = notificationText(item, t);
  return (
    <li
      aria-label={item.read ? undefined : `${t("notifications.unread")}. ${text}`}
      className={cn(
        "flex gap-3 border-l-4 border-l-transparent p-3 sm:p-4",
        !item.read && "border-l-primary bg-primary-soft/40",
        urgent && !item.read && "border-l-destructive bg-destructive-soft/60",
      )}
    >
      <span
        className={cn(
          "grid size-10 shrink-0 place-items-center rounded-lg",
          urgent ? "bg-destructive-soft text-destructive" : "bg-primary-soft text-primary",
        )}
      >
        <Icon className="size-5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          {urgent ? (
            <span className="inline-flex items-center gap-1 rounded-full border-[1.5px] border-destructive bg-card px-2 py-0.5 text-xs font-bold text-destructive">
              <Siren className="size-3" aria-hidden />
              {t("notifications.urgent")} · {t(`notifications.kind.${item.kind}`)}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full border bg-card px-2 py-0.5 text-xs font-bold">
              <Icon className="size-3" aria-hidden />
              {t(`notifications.kind.${item.kind}`)}
            </span>
          )}
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
            <Building2 className="size-3" aria-hidden />
            {item.plant?.code ?? t("notifications.allPlants")}
          </span>
          <span className="tnum ml-auto text-xs text-muted-foreground">
            {whenText(item.created_at, t)}
          </span>
        </div>
        <p className={cn("text-sm break-words", !item.read && "font-bold")}>{text}</p>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link
            to={item.link}
            onClick={() => onOpen(item)}
            className="inline-flex min-h-8 items-center gap-1 text-sm font-semibold text-primary underline"
          >
            {t(`notifications.link.${LINK_WORDS[item.kind] ?? "list"}`)}
            <ArrowRight className="size-4" aria-hidden />
          </Link>
          {item.read ? null : (
            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-primary">
              <span className="size-2 rounded-full bg-primary" aria-hidden />
              {t("notifications.unread")}
            </span>
          )}
        </div>
      </div>
    </li>
  );
}
