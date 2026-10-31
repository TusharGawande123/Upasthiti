// The timeline of one day inside the day drawer (spec M5 §4.6): every punch, review, correction,
// leave, holiday and weekly-off line in time order, each with an icon AND words. The server sends
// the lines already in order and says which punches count; nothing is decided here.

import type { TFunction } from "i18next";
import {
  CalendarHeart,
  Check,
  ClipboardCheck,
  Flag,
  LogIn,
  LogOut,
  Moon,
  Pencil,
  Sun,
  WifiOff,
} from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { formatDate, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TimelineItem } from "./use-day-detail";

type Props = { items: TimelineItem[]; canOpenPunchLog: boolean };

function Tag({ children, tone }: { children: ReactNode; tone?: "good" | "flag" | "mute" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold",
        tone === "good" && "border-[#bfe3d2] bg-[#e6f5ee] text-[#04694b]",
        tone === "flag" && "border-[#f1d18a] bg-[#fff3d6] text-[#8f5300]",
        (tone === "mute" || !tone) && "bg-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

function Line({
  icon,
  muted,
  children,
}: {
  icon: ReactNode;
  muted?: boolean;
  children: ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden
        className={cn(
          "mt-1 grid size-9 shrink-0 place-items-center rounded-full border-2 bg-card text-primary",
          muted && "border-dashed text-muted-foreground",
        )}
      >
        {icon}
      </span>
      <div
        className={cn("min-w-0 flex-1 space-y-1.5 rounded-md border p-3", muted && "border-dashed")}
      >
        {children}
      </div>
    </li>
  );
}

function PunchLine({
  item,
  canOpenPunchLog,
}: {
  item: Extract<TimelineItem, { kind: "punch" }>;
  canOpenPunchLog: boolean;
}) {
  const { t } = useTranslation();
  const isIn = item.direction === "in";
  const ignored = item.ignored_by_correction_id !== null;
  const flagged = item.decision === "flagged";
  return (
    <Line
      icon={isIn ? <LogIn className="size-4" /> : <LogOut className="size-4" />}
      muted={!item.counts}
    >
      <p className="flex flex-wrap items-center gap-2">
        <b className={cn("tnum text-lg", ignored && "line-through")}>
          {formatTime(item.punch_time)}
        </b>
        <Tag>{isIn ? t("corrections.in") : t("corrections.out")}</Tag>
        {item.counts ? (
          <Tag tone="good">
            <Check className="size-3" aria-hidden />
            {t("attendance.timeline.counts")}
          </Tag>
        ) : (
          <Tag tone="mute">{t("attendance.timeline.notCounted")}</Tag>
        )}
        {flagged ? (
          <Tag tone="flag">
            <Flag className="size-3" aria-hidden />
            {t("attendance.timeline.flagged")}
          </Tag>
        ) : null}
      </p>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
        {item.kiosk ? <span>{item.kiosk.name}</span> : null}
        <span>{item.method === "face" ? t("punches.method.face") : t("punches.method.card")}</span>
        <span>{t(`punches.result.${item.decision}`, { defaultValue: item.decision })}</span>
        {item.was_offline ? (
          <span className="inline-flex items-center gap-1">
            <WifiOff className="size-3.5" aria-hidden />
            {t("attendance.timeline.offline")}
          </span>
        ) : null}
      </p>
      <p className="flex flex-wrap gap-2">
        {item.role === "first_in" ? (
          <Tag tone="good">{t("attendance.timeline.firstIn")}</Tag>
        ) : null}
        {item.role === "last_out" ? (
          <Tag tone="good">{t("attendance.timeline.lastOut")}</Tag>
        ) : null}
        {item.role === "extra" ? <Tag>{t("attendance.timeline.extra")}</Tag> : null}
        {ignored ? <Tag tone="mute">{t("attendance.timeline.notUsed")}</Tag> : null}
        {item.carry_over ? <Tag>{t("attendance.timeline.carryOver")}</Tag> : null}
      </p>
      {canOpenPunchLog ? (
        <Link
          to="/admin/punches"
          className="inline-block text-[13px] font-semibold text-primary underline"
        >
          {t("attendance.day.openPunchLog")}
        </Link>
      ) : null}
    </Line>
  );
}

export function DayTimeline({ items, canOpenPunchLog }: Props) {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="day-timeline-title" className="space-y-3">
      <p className="flex items-center justify-between">
        <b id="day-timeline-title">{t("attendance.timeline.title")}</b>
        <span className="text-[13px] text-muted-foreground">
          {t("attendance.timeline.count", { count: items.length })}
        </span>
      </p>
      <ol className="space-y-3">
        {items.map((item, index) => {
          const key = `${item.kind}-${index}`;
          switch (item.kind) {
            case "punch":
              return <PunchLine key={key} item={item} canOpenPunchLog={canOpenPunchLog} />;
            case "review":
              return (
                <Line key={key} icon={<ClipboardCheck className="size-4" />}>
                  <p className="flex flex-wrap items-center gap-2">
                    <b>{reviewTitle(item, t)}</b>
                    <Tag tone="good">{t("attendance.timeline.review")}</Tag>
                  </p>
                  <p className="text-[13px] text-muted-foreground">
                    {item.reviewed_by.name} · {formatDate(item.reviewed_at)}{" "}
                    {formatTime(item.reviewed_at)}
                  </p>
                  {item.reason ? (
                    <p className="rounded-md bg-muted p-2 text-[13px]">
                      <span className="block text-muted-foreground">
                        {t("attendance.timeline.reasonSuperOnly")}
                      </span>
                      {item.reason}
                    </p>
                  ) : (
                    <p className="text-[13px] text-muted-foreground">
                      {t("attendance.timeline.reasonHidden")}
                    </p>
                  )}
                </Line>
              );
            case "correction":
              return (
                <Line key={key} icon={<Pencil className="size-4" />}>
                  <p className="flex flex-wrap items-center gap-2">
                    <b>{correctionTitle(item, t)}</b>
                    <Tag tone={item.state === "approved" ? "good" : "mute"}>
                      {t(`corrections.state.${item.state}`)}
                    </Tag>
                  </p>
                  <p className="text-[13px] text-muted-foreground">
                    {t("corrections.askedBy", { name: item.requested_by })} ·{" "}
                    {formatDate(item.requested_at)} {formatTime(item.requested_at)}
                  </p>
                  {item.decided_by && item.decided_at ? (
                    <p className="text-[13px] text-muted-foreground">
                      {t("corrections.decidedBy", {
                        name: item.decided_by,
                        date: `${formatDate(item.decided_at)} ${formatTime(item.decided_at)}`,
                      })}
                    </p>
                  ) : null}
                  <p className="rounded-md bg-muted p-2 text-[13px]">{item.reason}</p>
                  {item.decision_reason ? (
                    <p className="rounded-md bg-muted p-2 text-[13px]">{item.decision_reason}</p>
                  ) : null}
                </Line>
              );
            case "leave":
              return (
                <Line key={key} icon={<CalendarHeart className="size-4" />}>
                  <p className="font-bold">
                    {item.is_paid ? t("attendance.code.PL") : t("attendance.code.UL")}
                  </p>
                  {item.reason ? <p className="text-[13px]">{item.reason}</p> : null}
                </Line>
              );
            case "holiday":
              return (
                <Line key={key} icon={<Sun className="size-4" />}>
                  <p className="font-bold">{t("attendance.code.H")}</p>
                </Line>
              );
            case "weekly_off":
              return (
                <Line key={key} icon={<Moon className="size-4" />}>
                  <p className="font-bold">{t("attendance.code.WO")}</p>
                </Line>
              );
            default:
              return null;
          }
        })}
      </ol>
    </section>
  );
}

function reviewTitle(item: Extract<TimelineItem, { kind: "review" }>, t: TFunction) {
  if (item.action === "approved" && item.direction) {
    return t("punches.review.approvedAs", {
      direction: item.direction === "in" ? t("corrections.in") : t("corrections.out"),
    });
  }
  const known = { approved: "approved", not_accepted: "notAccepted", confirmed: "confirmed" };
  const word = known[item.action as keyof typeof known];
  return word ? t(`punches.review.${word}`) : item.action;
}

function correctionTitle(item: Extract<TimelineItem, { kind: "correction" }>, t: TFunction) {
  const kind = t(`corrections.kind.${item.correction_kind}`);
  const parts: string[] = [];
  if (item.in_time) parts.push(`${t("corrections.in")} ${formatTime(item.in_time)}`);
  if (item.out_time) parts.push(`${t("corrections.out")} ${formatTime(item.out_time)}`);
  if (item.status_value) parts.push(t(`corrections.status.${item.status_value}`));
  return parts.length > 0 ? `${kind}: ${parts.join(" · ")}` : kind;
}
