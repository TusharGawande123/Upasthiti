// Small pieces of the punch log table and dialogs: who, what happened, and the photo state.
// Status is never colour alone: every badge has an icon AND a word (design gate C).
import {
  ArrowDown,
  ArrowUp,
  CircleCheck,
  CircleDashed,
  CircleHelp,
  CircleX,
  EyeOff,
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
import { formatDate } from "@/lib/format";
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
  const text =
    punch.decision === "accepted"
      ? `${t("punches.result.accepted")} ${t(`punches.direction.${punch.direction ?? "in"}`)}`
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
  const code = punch.reason_codes[0];
  return (
    <span className="block space-y-1">
      <ResultBadge decision={punch.decision} />
      {how ? <span className="block text-sm">{how}</span> : null}
      {code ? (
        <span className="block">
          <span className="block text-sm">{reasonText(code)}</span>
          <span className="code text-xs text-muted-foreground">{code}</span>
        </span>
      ) : null}
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
