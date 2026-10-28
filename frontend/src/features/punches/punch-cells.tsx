// Small pieces of the punch log table and dialogs: who, what happened, and the photo state.
// Status is never colour alone: every badge has an icon AND a word (design gate C).

import type { TFunction } from "i18next";
import {
  ArrowDown,
  ArrowUp,
  CircleCheck,
  CircleDashed,
  CircleHelp,
  CircleX,
  EyeOff,
  Flag,
  Hourglass,
  IdCard,
  ImageOff,
  ImagePlus,
  Keyboard,
  LogIn,
  LogOut,
  Moon,
  ScanFace,
  TriangleAlert,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatTime } from "@/lib/format";
import type { PunchItem } from "./use-punches";

/** The words for a reason code; an unknown code is shown as it is. */
export function useReasonText() {
  const { t } = useTranslation();
  return (code: string) => t(`punchReasons.${code}`, { defaultValue: code });
}

export function EmployeeCell({ punch }: { punch: PunchItem }) {
  const { t } = useTranslation();
  if (punch.employee) {
    return (
      <span className="block">
        <span className="block font-semibold">{punch.employee.name}</span>
        <span className="code text-xs text-muted-foreground">{punch.employee.code}</span>
      </span>
    );
  }
  // A face that was not matched has no name (the server never names a rejected face punch).
  if (punch.method === "face") {
    return (
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <CircleHelp className="size-4" aria-hidden />
        {punch.decision === "rejected" ? t("punches.faceNotMatched") : t("punches.unknownFace")}
      </span>
    );
  }
  // A Plant Head must not learn who a person of another plant is (spec §4.10).
  if (punch.employee_hidden) {
    return (
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <EyeOff className="size-4" aria-hidden />
        {t("punches.otherPlantCard")}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-muted-foreground">
      <CircleHelp className="size-4" aria-hidden />
      {t("punches.unknownCard")}
    </span>
  );
}

export function DirectionBadge({ direction }: { direction: PunchItem["direction"] }) {
  const { t } = useTranslation();
  if (direction === null) return <span className="text-muted-foreground">–</span>;
  return direction === "in" ? (
    <Badge tone="success">
      <LogIn aria-hidden />
      {t("punches.direction.in")}
    </Badge>
  ) : (
    <Badge tone="primary">
      <LogOut aria-hidden />
      {t("punches.direction.out")}
    </Badge>
  );
}

/** Face (blue) or Card (outline): icon and word, never colour alone (spec M3 §4.11). */
export function MethodBadge({ method }: { method: string }) {
  const { t } = useTranslation();
  return method === "face" ? (
    <Badge tone="primary">
      <ScanFace aria-hidden />
      {t("punches.method.face")}
    </Badge>
  ) : (
    <Badge tone="neutral">
      <IdCard aria-hidden />
      {t("punches.method.card")}
    </Badge>
  );
}

export function ResultBadge({ decision }: { decision: PunchItem["decision"] }) {
  const { t } = useTranslation();
  // The server was not sure whose face it was and asked for the employee code: not a rejection.
  if (decision === "needs_code") {
    return (
      <Badge tone="warning">
        <Keyboard aria-hidden />
        {t("punches.result.needsCode")}
      </Badge>
    );
  }
  // M4: counts as IN/OUT at once, and the Super Admin checks it later (decision 0025 item 3).
  if (decision === "flagged") {
    return (
      <Badge tone="warning">
        <Flag aria-hidden />
        {t("punches.result.flagged")}
      </Badge>
    );
  }
  return decision === "accepted" ? (
    <Badge tone="success">
      <CircleCheck aria-hidden />
      {t("punches.result.accepted")}
    </Badge>
  ) : (
    <Badge tone="danger">
      <CircleX aria-hidden />
      {t("punches.result.rejected")}
    </Badge>
  );
}

/** "Accepted IN", or "Rejected · Card blocked": the result in one line of words. */
export function PunchResultText({ punch, small = false }: { punch: PunchItem; small?: boolean }) {
  const { t } = useTranslation();
  const reasonText = useReasonText();
  const direction = t(`punches.direction.${punch.direction ?? "in"}`);
  const text =
    punch.decision === "accepted"
      ? `${t("punches.result.accepted")} ${direction}`
      : punch.decision === "flagged"
        ? `${t("punches.result.flagged")} ${direction} · ${reasonText(punch.reason_codes[0] ?? "")}`
        : `${t("punches.result.rejected")} · ${reasonText(punch.reason_codes[0] ?? "")}`;
  return <span className={small ? "text-xs text-muted-foreground" : "text-sm"}>{text}</span>;
}

/** How the face punch was decided, in words ("By face", "By code"); nothing for a card. */
export function howText(punch: PunchItem, t: (key: string) => string): string | null {
  if (punch.method !== "face") return null;
  if (punch.decision === "accepted") {
    return t(punch.match_mode === "code" ? "punches.how.code" : "punches.how.face");
  }
  if (punch.decision === "rejected" && punch.match_mode === "code") {
    return t("punches.how.codeFailed");
  }
  return null;
}

/**
 * Result and reason in one cell (design gate C): the badge, how it was decided, the reason words
 * with the code for the admin, and the link between a "Asked for code" row and its answer.
 */
export function ResultCell({
  punch,
  onOpenPunch,
}: {
  punch: PunchItem;
  onOpenPunch: (punchId: string) => void;
}) {
  const { t } = useTranslation();
  const reasonText = useReasonText();
  const how = howText(punch, t);
  // A flagged punch shows every flag; a rejection its reason (the flags after it are for review).
  const codes = punch.decision === "flagged" ? punch.reason_codes : punch.reason_codes.slice(0, 1);
  return (
    <span className="block space-y-1">
      <ResultBadge decision={punch.decision} />
      {how ? <span className="block text-sm">{how}</span> : null}
      {codes.map((code) => (
        <span key={code} className="block">
          <span className="block text-sm">{reasonText(code)}</span>
          <span className="code text-xs text-muted-foreground">{code}</span>
        </span>
      ))}
      <ReviewMark punch={punch} />
      <OfflineMark punch={punch} />
      {punch.followed_by_punch_id ? (
        <button
          type="button"
          onClick={() => onOpenPunch(punch.followed_by_punch_id as string)}
          className="flex cursor-pointer items-center gap-1 text-xs font-semibold text-primary underline"
        >
          <ArrowDown className="size-3.5" aria-hidden />
          {t("punches.link.then")}
        </button>
      ) : null}
      {punch.follows_punch_id ? (
        <button
          type="button"
          onClick={() => onOpenPunch(punch.follows_punch_id as string)}
          className="flex cursor-pointer items-center gap-1 text-xs font-semibold text-primary underline"
        >
          <ArrowUp className="size-3.5" aria-hidden />
          {t("punches.link.after")}
        </button>
      ) : null}
    </span>
  );
}

/**
 * The Super Admin's review of a flagged or rejected punch, as text (spec M4 §4.9). Every role
 * sees it; only the Super Admin can open the review panel and change it.
 */
export function ReviewMark({ punch }: { punch: PunchItem }) {
  const { t } = useTranslation();
  switch (punch.review_state) {
    case "to_check":
      return (
        <span className="block text-xs font-semibold text-warning">
          {t("punches.review.toCheck")}
        </span>
      );
    case "confirmed":
      return (
        <span className="flex items-center gap-1 text-xs font-semibold text-success">
          <CircleCheck className="size-3.5" aria-hidden />
          {t("punches.review.confirmed")}
        </span>
      );
    case "not_accepted":
      return (
        <span className="flex items-center gap-1 text-xs font-semibold text-destructive">
          <CircleX className="size-3.5" aria-hidden />
          {t("punches.review.notAccepted")}
        </span>
      );
    case "approved":
      return (
        <span className="flex items-center gap-1 text-xs font-semibold text-primary">
          <CircleCheck className="size-3.5" aria-hidden />
          {t("punches.review.approvedAs", {
            direction: t(`punches.direction.${punch.review_direction ?? "in"}`),
          })}
        </span>
      );
    default:
      return null;
  }
}

/** "⏳ Offline, sent 09:02": a punch saved on the gate device and sent later. */
export function OfflineMark({ punch }: { punch: PunchItem }) {
  const { t } = useTranslation();
  if (!punch.was_offline) return null;
  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground">
      <Hourglass className="size-3.5" aria-hidden />
      {t("punches.offlineSent", { time: formatTime(punch.server_received_at) })}
    </span>
  );
}

type Translate = TFunction;

/** "0 min", "52 min" or "2 h 10 min". */
export function formatMinutes(minutes: number, t: Translate) {
  if (minutes < 60) return t("review.duration.minutes", { minutes });
  return t("review.duration.hours", { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
}

/** How long a saved punch waited on the gate device (at least "1 min"). */
export function formatDelay(seconds: number, t: Translate) {
  return formatMinutes(Math.max(1, Math.round(seconds / 60)), t);
}

export function ReasonCell({ punch }: { punch: PunchItem }) {
  const reasonText = useReasonText();
  const code = punch.reason_codes[0];
  if (!code) return <span className="text-muted-foreground">–</span>;
  return (
    <span className="block">
      <span className="block">{reasonText(code)}</span>
      <span className="code text-xs text-muted-foreground">{code}</span>
    </span>
  );
}

/** The photo state as words (no thumbnail: every view of a photo is audited). */
export function PhotoStateCell({ punch, showDark }: { punch: PunchItem; showDark: boolean }) {
  const { t } = useTranslation();
  const { snapshot } = punch;
  // An accepted face punch keeps no photo; a code answer shows the photo of its question.
  if (snapshot.state === "none" && punch.method === "face") {
    return (
      <span className="text-muted-foreground">
        {punch.follows_punch_id ? t("punches.photoOfAsked") : t("punches.noPhotoFace")}
      </span>
    );
  }
  switch (snapshot.state) {
    case "stored":
      return (
        <span className="block">
          <span className="flex items-center gap-1.5">
            <ImagePlus className="size-4" aria-hidden />
            {t("punches.photoState.stored")}
          </span>
          {snapshot.expires_at ? (
            <span className="tnum block text-xs text-muted-foreground">
              {t("punches.photoState.keptUntil", { date: formatDate(snapshot.expires_at) })}
            </span>
          ) : null}
          {showDark && snapshot.is_dark ? (
            <Badge tone="neutral" className="mt-1">
              <Moon aria-hidden />
              {t("punches.darkPhoto")}
            </Badge>
          ) : null}
          {showDark && snapshot.face_found === false ? (
            <Badge tone="neutral" className="mt-1 border-dashed">
              <CircleDashed aria-hidden />
              {t("punches.noFacePhoto")}
            </Badge>
          ) : null}
        </span>
      );
    case "purged":
      return (
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <ImageOff className="size-4" aria-hidden />
          {snapshot.purged_at
            ? t("punches.photoState.purged", { date: formatDate(snapshot.purged_at) })
            : t("punches.photoState.purgedNoDate")}
        </span>
      );
    case "upload_failed":
      return (
        <span className="flex items-center gap-1.5 font-semibold text-destructive">
          <TriangleAlert className="size-4" aria-hidden />
          {t("punches.photoState.notSaved")}
        </span>
      );
    default:
      return <span className="text-muted-foreground">– {t("punches.photoState.none")}</span>;
  }
}
