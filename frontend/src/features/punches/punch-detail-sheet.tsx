// The punch detail side sheet (spec M3 §4.11, design gate C): the facts of one punch for every
// role, and for the Super Admin only what the face check measured, the code that was typed and
// the photo. Other roles get no scores and no photo buttons (the server sends them no `face`).
import {
  CircleCheck,
  CircleMinus,
  CircleX,
  Columns2,
  Eye,
  Keyboard,
  Lock,
  ScanFace,
  TriangleAlert,
} from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { describeError } from "@/features/auth/error-message";
import { useSettings } from "@/features/settings/use-settings";
import { formatDate, formatTimeWithSeconds } from "@/lib/format";
import { cn } from "@/lib/utils";
import { howText, MethodBadge, ResultBadge, ReviewMark, useReasonText } from "./punch-cells";
import { type PunchDetail, type PunchFaceDetail, usePunchDetail } from "./use-punches";

type Verdict = "passed" | "tooLow" | "notUsed";

function VerdictMark({ verdict }: { verdict: Verdict }) {
  const { t } = useTranslation();
  const Icon = verdict === "passed" ? CircleCheck : verdict === "tooLow" ? CircleX : CircleMinus;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-semibold",
        verdict === "passed" && "text-success",
        verdict === "tooLow" && "text-destructive",
        verdict === "notUsed" && "text-muted-foreground",
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {t(`punches.detail.${verdict}`)}
    </span>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-3 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function ScoreTile({
  title,
  value,
  limit,
  verdict,
}: {
  title: string;
  value: string;
  limit: string;
  verdict: Verdict;
}) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold">{title}</span>
        <span className="tnum text-xl font-extrabold">{value}</span>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">{limit}</span>
        <VerdictMark verdict={verdict} />
      </div>
    </div>
  );
}

const number = (value: number | null, digits = 2) => (value === null ? "–" : value.toFixed(digits));

// The limits are today's settings: a punch does not store the limits of its own day.
function FaceCheck({ face, punch }: { face: PunchFaceDetail; punch: PunchDetail }) {
  const { t } = useTranslation();
  const settings = useSettings();
  const value = (key: string) =>
    Number(settings.data?.settings.find((setting) => setting.key === key)?.value ?? Number.NaN);
  const byCode = face.match_mode === "code";
  const matchLimit = value(byCode ? "face_code_match_threshold" : "face_match_threshold");
  const spoofLimit = value("face_antispoof_threshold");
  const turnLimit = value("face_min_yaw_degrees");
  const verdict = (score: number | null, limit: number): Verdict =>
    score === null || Number.isNaN(limit) ? "notUsed" : score >= limit ? "passed" : "tooLow";
  const yaw = face.yaw_degrees;
  const turned = yaw === null ? null : Math.abs(yaw);
  const matched = punch.decision === "accepted";

  return (
    <section className="space-y-2">
      <h3 className="flex flex-wrap items-center gap-2 text-xs font-bold tracking-wide text-muted-foreground uppercase">
        <ScanFace className="size-4" aria-hidden />
        {t("punches.detail.face")}
        <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 normal-case">
          <Lock className="size-3" aria-hidden />
          {t("punches.detail.superOnly")}
        </span>
      </h3>
      {face.claimed_employee ? (
        <div
          className={cn(
            "rounded-lg border p-3 text-sm",
            matched ? "border-success/40 bg-success-soft" : "border-warning/50 bg-warning-soft",
          )}
        >
          <p className="flex items-center gap-2 font-bold">
            <Keyboard className="size-4" aria-hidden />
            {t(matched ? "punches.detail.codeTypedOk" : "punches.detail.codeTyped", {
              code: face.claimed_employee.code,
            })}
          </p>
          <p className="mt-1">{face.claimed_employee.name}</p>
          {matched ? null : (
            <p className="mt-1 flex items-start gap-2 text-warning">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              {t("punches.detail.proxy")}
            </p>
          )}
        </div>
      ) : null}
      <ScoreTile
        title={t("punches.detail.matchScore")}
        value={number(face.match_score)}
        limit={t("punches.detail.todayLimit", { limit: number(matchLimit) })}
        verdict={verdict(face.match_score, matchLimit)}
      />
      <ScoreTile
        title={t("punches.detail.secondBest")}
        value={byCode ? "–" : number(face.second_best_score)}
        limit={byCode ? t("punches.detail.notUsedCode") : ""}
        verdict={byCode || face.second_best_score === null ? "notUsed" : "passed"}
      />
      <ScoreTile
        title={t("punches.detail.antispoof")}
        value={number(face.antispoof_score)}
        limit={t("punches.detail.todayLimit", { limit: number(spoofLimit) })}
        verdict={verdict(face.antispoof_score, spoofLimit)}
      />
      <ScoreTile
        title={t("punches.detail.headTurn")}
        value={
          yaw === null
            ? "–"
            : t(yaw >= 0 ? "punches.detail.degreesLeft" : "punches.detail.degreesRight", {
                degrees: Math.abs(Math.round(yaw)),
              })
        }
        limit={t("punches.detail.todayLimit", { limit: `${turnLimit}°` })}
        verdict={
          turned === null || Number.isNaN(turnLimit)
            ? "notUsed"
            : turned >= turnLimit
              ? "passed"
              : "tooLow"
        }
      />
      <dl className="rounded-lg border px-3">
        <Row label={t("punches.detail.challenge")}>{face.challenge ?? "–"}</Row>
        <Row label={t("punches.detail.matchMode")}>
          {face.match_mode
            ? t(byCode ? "punches.detail.codeMode" : "punches.detail.oneToMany")
            : "–"}
        </Row>
        <Row label={t("punches.detail.model")}>{face.model_id ?? "–"}</Row>
      </dl>
    </section>
  );
}

export function PunchDetailSheet({
  punchId,
  isSuperAdmin,
  onClose,
  onOpenPunch,
  onViewPhoto,
  onCompare,
}: {
  punchId: string;
  isSuperAdmin: boolean;
  onClose: () => void;
  onOpenPunch: (punchId: string) => void;
  onViewPhoto: (punch: PunchDetail) => void;
  onCompare: (punch: PunchDetail) => void;
}) {
  const { t } = useTranslation();
  const reasonText = useReasonText();
  const detail = usePunchDetail(punchId);
  const punch = detail.data;
  const reason = punch?.reason_codes[0];
  const hasPhoto = punch?.snapshot.state === "stored";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        aria-describedby="punch-detail-when"
        className="top-0 right-0 left-auto h-dvh max-h-dvh w-full max-w-[520px] translate-x-0 translate-y-0 rounded-none p-0 data-[state=open]:slide-in-from-right-8"
      >
        <div className="flex h-full flex-col">
          <header className="border-b p-5 pr-12">
            <DialogTitle>
              {punch ? (
                <span className="flex flex-wrap items-center gap-2">
                  <ResultBadge decision={punch.decision} />
                  {reason ? <span className="text-lg">{reasonText(reason)}</span> : null}
                </span>
              ) : (
                t("punches.detail.title")
              )}
            </DialogTitle>
            <DialogDescription id="punch-detail-when">
              {punch
                ? `${formatDate(punch.server_received_at)} ${formatTimeWithSeconds(punch.server_received_at)} · ${punch.kiosk.name} · ${punch.plant.code ?? ""}`
                : t("punches.detail.loading")}
            </DialogDescription>
          </header>

          <div className="flex-1 space-y-5 overflow-y-auto p-5">
            {detail.isPending ? <Skeleton className="h-48 w-full" /> : null}
            {detail.isError ? (
              <Alert tone="danger">
                <span>{describeError(detail.error, t)}</span>
              </Alert>
            ) : null}
            {punch ? (
              <>
                <section>
                  <h3 className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
                    {t("punches.detail.punch")}
                  </h3>
                  <dl>
                    <Row label={t("punches.columns.employee")}>
                      {punch.employee ? (
                        <span>
                          <b>{punch.employee.name}</b>{" "}
                          <span className="code text-xs">{punch.employee.code}</span>
                          <Link
                            to={`/admin/employees/${punch.employee.id}`}
                            className="ml-2 text-xs font-semibold text-primary underline"
                          >
                            {t("punches.detail.openEmployee")}
                          </Link>
                        </span>
                      ) : punch.face?.claimed_employee ? (
                        <span>
                          {t("punches.detail.notPunched")} <b>{punch.face.claimed_employee.name}</b>{" "}
                          (<span className="code">{punch.face.claimed_employee.code}</span>)
                        </span>
                      ) : punch.method === "face" ? (
                        t("punches.faceNotMatched")
                      ) : (
                        t("punches.unknownCard")
                      )}
                    </Row>
                    <Row label={t("punches.columns.method")}>
                      <MethodBadge method={punch.method} />
                    </Row>
                    <Row label={t("punches.columns.result")}>
                      <ResultBadge decision={punch.decision} />{" "}
                      <span>{howText(punch, t) ?? ""}</span>
                    </Row>
                    <Row label={t("punches.columns.direction")}>
                      {punch.direction ? t(`punches.direction.${punch.direction}`) : "–"}
                    </Row>
                    <Row label={t("punches.columns.reason")}>
                      {reason ? (
                        <span>
                          {reasonText(reason)}{" "}
                          <span className="code text-xs text-muted-foreground">{reason}</span>
                        </span>
                      ) : (
                        "–"
                      )}
                    </Row>
                    <Row label={t("punches.detail.serverTime")}>
                      <span className="tnum">
                        {formatDate(punch.server_received_at)}{" "}
                        {formatTimeWithSeconds(punch.server_received_at)}
                      </span>
                    </Row>
                    {punch.was_offline && punch.punch_time ? (
                      <Row label={t("punches.detail.punchTime")}>
                        <span className="tnum">
                          {formatDate(punch.punch_time)} {formatTimeWithSeconds(punch.punch_time)}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {punch.time_proof === "anchored"
                            ? t("review.sheet.timeAnchored")
                            : t("review.sheet.timeUnproven")}
                        </span>
                      </Row>
                    ) : null}
                    {punch.review_state ? (
                      <Row label={t("punches.detail.review")}>
                        <ReviewMark punch={punch} />
                        {isSuperAdmin ? (
                          <Link
                            to={`/admin/review?punch=${punch.id}`}
                            className="mt-1 inline-block text-xs font-semibold text-primary underline"
                          >
                            {t("punches.detail.openReview")}
                          </Link>
                        ) : null}
                      </Row>
                    ) : isSuperAdmin && punch.decision === "rejected" ? (
                      <Row label={t("punches.detail.review")}>
                        <Link
                          to={`/admin/review?punch=${punch.id}&tab=rejected`}
                          className="text-xs font-semibold text-primary underline"
                        >
                          {t("punches.detail.openReview")}
                        </Link>
                      </Row>
                    ) : null}
                    <Row label={t("punches.columns.kiosk")}>
                      {punch.kiosk.name} · <span className="code">{punch.plant.code}</span>
                    </Row>
                  </dl>
                </section>

                {punch.follows_punch_id || punch.followed_by_punch_id ? (
                  <section className="space-y-2">
                    <h3 className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
                      {t("punches.detail.steps")}
                    </h3>
                    {[punch.follows_punch_id, punch.followed_by_punch_id]
                      .filter((id): id is string => Boolean(id))
                      .map((id) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => onOpenPunch(id)}
                          className="block w-full cursor-pointer rounded-lg border px-3 py-2 text-left text-sm font-semibold text-primary underline hover:bg-muted"
                        >
                          {t("punches.detail.openPunch")}
                          <span className="ml-2 font-normal text-muted-foreground no-underline">
                            {id === punch.follows_punch_id
                              ? t("punches.link.after")
                              : t("punches.link.then")}
                          </span>
                        </button>
                      ))}
                  </section>
                ) : null}

                {punch.face ? <FaceCheck face={punch.face} punch={punch} /> : null}

                {isSuperAdmin ? (
                  <section>
                    <h3 className="flex flex-wrap items-center gap-2 text-xs font-bold tracking-wide text-muted-foreground uppercase">
                      {t("punches.detail.photo")}
                      <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 normal-case">
                        <Lock className="size-3" aria-hidden />
                        {t("punches.detail.superOnly")}
                      </span>
                    </h3>
                    <p className="mt-1 text-sm">
                      {hasPhoto
                        ? t("punches.photoState.stored")
                        : punch.method === "face" && !punch.follows_punch_id
                          ? t("punches.detail.noPhotoKept")
                          : t("punches.photoState.none")}
                    </p>
                  </section>
                ) : (
                  <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
                    {t("punches.detail.notShown")}
                  </p>
                )}
              </>
            ) : null}
          </div>

          {isSuperAdmin && punch && hasPhoto ? (
            <footer className="flex gap-3 border-t bg-card p-4">
              <Button className="flex-1" onClick={() => onViewPhoto(punch)}>
                <Eye aria-hidden />
                {t("punches.photo.view")}
              </Button>
              {punch.employee ? (
                <Button variant="outline" className="flex-1" onClick={() => onCompare(punch)}>
                  <Columns2 aria-hidden />
                  {t("punches.photo.compareShort")}
                </Button>
              ) : null}
            </footer>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
