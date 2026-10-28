// The review panel of one punch (spec M4 §4.8, design gate B 02-detail): a side sheet on a
// computer, full screen on a phone. Order: the punch and its flags, repeat-pattern hints (F-54),
// the related punch, the map, the time, the photo, the review history; the actions at the bottom.
// Every photo view goes through the M2 photo dialog, which the server audits.

import type { TFunction } from "i18next";
import {
  ChevronDown,
  ChevronUp,
  CircleCheck,
  CircleX,
  Clock,
  Eye,
  Flag,
  History,
  Info,
  Lock,
  MapPin,
  Pencil,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { lazy, type ReactNode, Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { describeError } from "@/features/auth/error-message";
import { formatDate, formatNumber, formatTimeWithSeconds } from "@/lib/format";
import { queryString } from "@/lib/paging";
import { cn } from "@/lib/utils";
import type { Draft } from "../plants/geofence-geometry";
import { PhotoDialog } from "../punches/photo-dialog";
import { formatDelay, MethodBadge, ResultBadge, useReasonText } from "../punches/punch-cells";
import type { PunchDetail } from "../punches/use-punches";
import { type DialogMode, ReviewDialog } from "./review-dialog";
import type { MapPoint } from "./review-map";
import {
  type ContextFence,
  type RelatedPunch,
  type ReviewAction,
  type ReviewContext,
  useReviewContext,
} from "./use-review";

const ReviewMap = lazy(() => import("./review-map").then((m) => ({ default: m.ReviewMap })));

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof Flag;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-2 text-xs font-bold tracking-wide text-muted-foreground uppercase">
        <Icon className="size-4" aria-hidden />
        {title}
      </h3>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-3 py-1 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

const when = (moment: string) => `${formatDate(moment)} ${formatTimeWithSeconds(moment)}`;

function toDraft(fence: ContextFence): Draft {
  return {
    shape: fence.shape,
    geojson: fence.geojson as GeoJSON.Polygon | GeoJSON.Point,
    radius_m: fence.radius_m ?? undefined,
  };
}

/** "18 m outside the drawn fence, inside the 25 m margin" and its two neighbours. */
export function distanceLine(distance: number | null, margin: number | null, t: TFunction) {
  if (distance === null) return null;
  const metres = Math.round(distance);
  if (metres === 0) return t("review.sheet.insideFence");
  if (margin !== null && metres <= margin) {
    return t("review.sheet.insideMargin", { metres, margin });
  }
  return t("review.sheet.beyondMargin", {
    metres,
    beyond: metres - (margin ?? 0),
    margin: margin ?? 0,
  });
}

function personOf(context: ReviewContext) {
  return context.punch.employee ?? context.claimed_employee;
}

function PunchSummary({ context }: { context: ReviewContext }) {
  const { t } = useTranslation();
  const reasonText = useReasonText();
  const { punch } = context;
  const person = personOf(context);
  const counts =
    punch.decision === "flagged" && punch.review_state !== "not_accepted"
      ? t("review.sheet.countsAs", { direction: t(`punches.direction.${punch.direction ?? "in"}`) })
      : punch.review_state === "approved"
        ? t("review.sheet.countsAs", {
            direction: t(`punches.direction.${punch.review_direction ?? "in"}`),
          })
        : t("review.sheet.doesNotCount");
  return (
    <Section title={t("review.sheet.punch")} icon={Flag}>
      <ul className="space-y-2">
        {punch.reason_codes.map((code, index) => {
          const isFlag = punch.decision === "flagged" || index > 0;
          return (
            <li
              key={code}
              className={cn(
                "rounded-lg border p-3 text-sm",
                isFlag
                  ? "border-warning/40 bg-warning-soft"
                  : "border-destructive/30 bg-destructive-soft",
              )}
            >
              <p className="flex flex-wrap items-center gap-2 font-semibold">
                {isFlag ? (
                  <Flag className="size-4" aria-hidden />
                ) : (
                  <CircleX className="size-4" aria-hidden />
                )}
                {reasonText(code)}
                <span className="code text-xs font-normal text-muted-foreground">{code}</span>
              </p>
              <p className="mt-1">{t(`punchReasons.${code}_help`, { defaultValue: "" })}</p>
            </li>
          );
        })}
      </ul>
      {context.claimed_employee && !punch.employee ? (
        <Alert tone="warning">
          <TriangleAlert aria-hidden />
          <span>
            {t("review.sheet.codeTyped", {
              code: context.claimed_employee.code,
              name: context.claimed_employee.name,
            })}
          </span>
        </Alert>
      ) : null}
      <dl>
        <Row label={t("punches.columns.employee")}>
          {person ? (
            <span>
              <b>{person.name}</b> <span className="code text-xs">{person.code}</span>
              <Link
                to={`/admin/employees/${person.id}`}
                className="ml-2 text-xs font-semibold text-primary underline"
              >
                {t("punches.detail.openEmployee")}
              </Link>
            </span>
          ) : (
            t("review.row.unknown")
          )}
        </Row>
        <Row label={t("punches.columns.method")}>
          <MethodBadge method={punch.method} />
        </Row>
        <Row label={t("punches.columns.result")}>
          <span className="flex flex-wrap items-center gap-2">
            <ResultBadge decision={punch.decision} />
            <span>{counts}</span>
          </span>
        </Row>
        <Row label={t("review.sheet.device")}>
          {punch.kiosk.name} · <span className="code">{punch.plant.code}</span>
        </Row>
      </dl>
    </Section>
  );
}

function Hints({ context }: { context: ReviewContext }) {
  const { t } = useTranslation();
  if (context.hints.length === 0) return null;
  const person = personOf(context);
  return (
    <Section title={t("review.hints.title")} icon={Info}>
      <p className="text-xs text-muted-foreground">{t("review.hints.note")}</p>
      {context.hints.map((hint) => (
        <p
          key={hint.kind}
          className="rounded-lg border border-dashed border-warning/60 bg-warning-soft px-3 py-2 text-sm text-warning"
        >
          {t(`review.hints.${hint.kind}`, { count: hint.count, code: person?.code ?? "" })}{" "}
          <Link to={`/admin/review${queryString(hint.filter)}`} className="font-semibold underline">
            {t("review.hints.show")}
          </Link>
        </p>
      ))}
    </Section>
  );
}

function RelatedCard({
  number,
  title,
  punch,
  onViewPhoto,
}: {
  number: 1 | 2;
  title: string;
  punch: PunchDetail;
  onViewPhoto: (punch: PunchDetail) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="min-w-0 flex-1 rounded-lg border p-3 text-sm">
      <p className="flex items-center gap-2 text-xs font-bold text-muted-foreground uppercase">
        <span
          className={cn(
            "grid size-6 place-items-center rounded-full text-xs text-white",
            number === 1 ? "bg-[#1d6bf3]" : "bg-[#b91c1c]",
          )}
        >
          {number}
        </span>
        {title}
      </p>
      <p className="tnum mt-1 text-[22px] font-bold">
        {formatTimeWithSeconds(punch.punch_time ?? punch.server_received_at)}
      </p>
      <p>{punch.kiosk.name}</p>
      <p className="code text-xs text-muted-foreground">{punch.plant.code}</p>
      <p className="mt-1 flex flex-wrap gap-1">
        <MethodBadge method={punch.method} />
        <ResultBadge decision={punch.decision} />
      </p>
      {punch.snapshot.state === "stored" ? (
        <Button size="sm" variant="outline" className="mt-2" onClick={() => onViewPhoto(punch)}>
          <Eye aria-hidden />
          {t("punches.photo.view")}
        </Button>
      ) : null}
    </div>
  );
}

function Related({
  context,
  related,
  onViewPhoto,
}: {
  context: ReviewContext;
  related: RelatedPunch[];
  onViewPhoto: (punch: PunchDetail) => void;
}) {
  const { t } = useTranslation();
  return (
    <Section title={t("review.sheet.twoPunches")} icon={History}>
      {related.map((other) => {
        const otherIsEarlier =
          (other.punch.punch_time ?? "") <
          (context.punch.punch_time ?? context.punch.server_received_at);
        const pair = otherIsEarlier ? [other.punch, context.punch] : [context.punch, other.punch];
        return (
          <div key={other.punch.id} className="space-y-2">
            <p className="text-sm font-semibold">{t(`review.relation.${other.relation}`)}</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              {pair.map((punch, index) => (
                <RelatedCard
                  key={punch.id}
                  number={(index + 1) as 1 | 2}
                  title={
                    punch.id === context.punch.id
                      ? t("review.sheet.thisPunch")
                      : t("review.sheet.otherPunch")
                  }
                  punch={punch}
                  onViewPhoto={onViewPhoto}
                />
              ))}
            </div>
            {other.distance_m !== null && other.speed_kmh !== null ? (
              <p className="rounded-lg bg-muted px-3 py-2 text-sm font-semibold">
                {t("review.sheet.speed", {
                  km: (other.distance_m / 1000).toFixed(1),
                  minutes: Math.round(other.minutes_apart),
                  speed: Math.round(other.speed_kmh),
                  limit: context.limits.impossible_travel_kmh,
                })}
              </p>
            ) : null}
          </div>
        );
      })}
    </Section>
  );
}

function MapSection({ context }: { context: ReviewContext }) {
  const { t } = useTranslation();
  const { punch } = context;
  const fence = context.geofence;
  const points: MapPoint[] = [];
  const firstRelated = context.related[0];
  if (punch.location) {
    points.push({
      lat: punch.location.lat,
      lon: punch.location.lon,
      accuracy_m: punch.location.accuracy_m,
      number: firstRelated ? 2 : undefined,
    });
  }
  if (firstRelated?.punch.location) {
    points.push({
      lat: firstRelated.punch.location.lat,
      lon: firstRelated.punch.location.lon,
      accuracy_m: firstRelated.punch.location.accuracy_m,
      number: 1,
    });
  }
  if (!fence && points.length === 0) return null;
  const line = distanceLine(context.distance_m, context.margin_m, t);
  return (
    <Section
      title={firstRelated ? t("review.sheet.whereBoth") : t("review.sheet.where")}
      icon={MapPin}
    >
      <Suspense fallback={<Skeleton className="h-72 w-full" />}>
        <ReviewMap
          fence={fence ? toDraft(fence) : null}
          marginM={context.margin_m ?? 0}
          points={points}
          label={line ?? t("review.sheet.where")}
        />
      </Suspense>
      {line ? <p className="text-sm font-bold">{line}</p> : null}
      {fence ? (
        <p className="text-xs text-muted-foreground">
          {t("review.sheet.fenceVersion", { version: fence.version })}
        </p>
      ) : null}
      {punch.location ? (
        <p className="text-xs text-muted-foreground">
          {t("review.sheet.accuracy", {
            metres: Math.round(punch.location.accuracy_m ?? 0),
            seconds: punch.location_age_s ?? 0,
          })}
        </p>
      ) : null}
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <li>━ {t("review.sheet.legendFence")}</li>
        <li>╌ {t("review.sheet.legendMargin")}</li>
        <li>● {t("review.sheet.legendPoint")}</li>
        <li>◌ {t("review.sheet.legendAccuracy")}</li>
      </ul>
    </Section>
  );
}

function TimeSection({ punch }: { punch: PunchDetail }) {
  const { t } = useTranslation();
  return (
    <Section title={t("review.sheet.time")} icon={Clock}>
      <dl>
        <Row label={t("review.sheet.serverReceived")}>
          <span className="tnum">{when(punch.server_received_at)}</span>
        </Row>
        {punch.was_offline ? (
          <>
            <Row label={t("review.sheet.punchTime")}>
              <span className="tnum">{when(punch.punch_time ?? punch.server_received_at)}</span>
            </Row>
            <Row label={t("review.sheet.delay")}>
              {formatDelay(punch.offline_delay_seconds ?? 0, t)}
            </Row>
          </>
        ) : null}
      </dl>
      {punch.was_offline ? (
        punch.time_proof === "anchored" ? (
          <p className="flex items-center gap-2 rounded-lg bg-success-soft px-3 py-2 text-sm font-semibold text-success">
            <ShieldCheck className="size-4" aria-hidden />
            {t("review.sheet.timeAnchored")}
          </p>
        ) : (
          <Alert tone="warning">
            <TriangleAlert aria-hidden />
            <span>
              <b>{t("review.sheet.timeUnproven")}</b> {t("review.sheet.timeUnprovenHelp")}
            </span>
          </Alert>
        )
      ) : (
        <p className="text-sm text-muted-foreground">{t("review.sheet.sameAsServer")}</p>
      )}
    </Section>
  );
}

function HistorySection({ context }: { context: ReviewContext }) {
  const { t } = useTranslation();
  return (
    <Section title={t("review.sheet.history")} icon={History}>
      {context.reviews.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("review.sheet.notReviewed")}</p>
      ) : (
        <ol className="space-y-2">
          {context.reviews.map((review, index) => (
            <li key={review.id ?? index} className="rounded-lg border p-3 text-sm">
              <p className="flex flex-wrap items-center gap-2 font-semibold">
                {t(`review.action.${review.action}`)}
                {review.direction ? ` · ${t(`punches.direction.${review.direction}`)}` : ""}
                {index === 0 ? (
                  <span className="rounded bg-primary-soft px-1.5 text-xs text-primary-soft-foreground">
                    {t("review.sheet.current")}
                  </span>
                ) : null}
              </p>
              <p className="text-xs text-muted-foreground">
                {review.reviewed_by?.name ?? ""}
                {review.reviewed_at ? ` · ${when(review.reviewed_at)}` : ""}
              </p>
              {review.reason ? (
                <blockquote className="mt-1 rounded bg-muted px-2 py-1">{review.reason}</blockquote>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}

function Actions({
  context,
  onOpen,
}: {
  context: ReviewContext;
  onOpen: (mode: DialogMode) => void;
}) {
  const { t } = useTranslation();
  const { punch } = context;
  if (context.reviews.length > 0) {
    return (
      <Button className="flex-1" variant="outline" onClick={() => onOpen("change")}>
        <Pencil aria-hidden />
        {t("review.actions.change")}
      </Button>
    );
  }
  if (punch.decision === "flagged") {
    return (
      <>
        <Button className="flex-1" onClick={() => onOpen("confirm")}>
          <CircleCheck aria-hidden />
          {t("review.actions.confirm")}
        </Button>
        <Button className="flex-1" variant="danger" onClick={() => onOpen("not_accepted")}>
          <CircleX aria-hidden />
          {t("review.actions.notAccepted")}
        </Button>
      </>
    );
  }
  if (context.approvable) {
    return (
      <Button className="flex-1" onClick={() => onOpen("approve")}>
        <CircleCheck aria-hidden />
        {t("review.actions.approve")}
      </Button>
    );
  }
  const repeat = punch.reason_codes[0] === "COOLDOWN_ACTIVE";
  return (
    <p className="flex-1 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
      {repeat ? t("review.sheet.repeatScan") : t("review.sheet.nobody")}
    </p>
  );
}

export function ReviewSheet({
  punchId,
  position,
  onClose,
  onMove,
  onReviewed,
}: {
  punchId: string;
  position: { index: number; total: number } | null;
  onClose: () => void;
  onMove: (offset: number) => void;
  onReviewed: (action: ReviewAction) => void;
}) {
  const { t } = useTranslation();
  const reasonText = useReasonText();
  const query = useReviewContext(punchId);
  const context = query.data;
  const [dialog, setDialog] = useState<DialogMode | null>(null);
  const [photoOf, setPhotoOf] = useState<PunchDetail | null>(null);
  const punch = context?.punch;
  const firstCode = punch?.reason_codes[0];

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent
          aria-describedby="review-sheet-when"
          className="top-0 right-0 left-auto h-dvh max-h-dvh w-full max-w-[520px] translate-x-0 translate-y-0 rounded-none p-0 data-[state=open]:slide-in-from-right-8"
        >
          <div className="flex h-full flex-col">
            <header className="border-b p-5 pr-12">
              <DialogTitle>
                {punch ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <ResultBadge decision={punch.decision} />
                    {firstCode ? <span className="text-lg">{reasonText(firstCode)}</span> : null}
                  </span>
                ) : (
                  t("review.sheet.loading")
                )}
              </DialogTitle>
              <DialogDescription id="review-sheet-when">
                {punch
                  ? `${when(punch.punch_time ?? punch.server_received_at)} · ${punch.kiosk.name} · ${punch.plant.code ?? ""}`
                  : ""}
              </DialogDescription>
              {position ? (
                <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                  <Button
                    size="icon"
                    variant="outline"
                    aria-label={t("review.sheet.previous")}
                    disabled={position.index === 0}
                    onClick={() => onMove(-1)}
                  >
                    <ChevronUp aria-hidden />
                  </Button>
                  <Button
                    size="icon"
                    variant="outline"
                    aria-label={t("review.sheet.next")}
                    disabled={position.index >= position.total - 1}
                    onClick={() => onMove(1)}
                  >
                    <ChevronDown aria-hidden />
                  </Button>
                  <span className="tnum">
                    {t("review.sheet.position", {
                      index: formatNumber(position.index + 1),
                      total: formatNumber(position.total),
                    })}
                  </span>
                </div>
              ) : null}
            </header>

            <div className="flex-1 space-y-6 overflow-y-auto p-5">
              {query.isPending ? <Skeleton className="h-64 w-full" /> : null}
              {query.isError ? (
                <Alert tone="danger">
                  <span>{describeError(query.error, t)}</span>
                </Alert>
              ) : null}
              {context && punch ? (
                <>
                  <PunchSummary context={context} />
                  <Hints context={context} />
                  {context.related.length > 0 ? (
                    <Related context={context} related={context.related} onViewPhoto={setPhotoOf} />
                  ) : null}
                  <MapSection context={context} />
                  <TimeSection punch={punch} />
                  <Section title={t("punches.detail.photo")} icon={Lock}>
                    {punch.snapshot.state === "stored" ? (
                      <>
                        <Button variant="outline" onClick={() => setPhotoOf(punch)}>
                          <Eye aria-hidden />
                          {t("punches.photo.view")}
                        </Button>
                        <p className="text-xs text-muted-foreground">
                          {t("review.sheet.photoAudited")}
                        </p>
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground">{t("review.row.noPhoto")}</p>
                    )}
                  </Section>
                  <HistorySection context={context} />
                </>
              ) : null}
            </div>

            {context ? (
              <footer className="border-t bg-card p-4">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Actions context={context} onOpen={setDialog} />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{t("review.sheet.nextOpens")}</p>
              </footer>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      {dialog && context ? (
        <ReviewDialog
          mode={dialog}
          context={context}
          onClose={() => setDialog(null)}
          onReload={() => {
            setDialog(null);
            query.refetch();
          }}
          onSaved={(action) => {
            setDialog(null);
            onReviewed(action);
          }}
        />
      ) : null}
      {photoOf ? (
        <PhotoDialog punches={[photoOf]} startId={photoOf.id} onClose={() => setPhotoOf(null)} />
      ) : null}
    </>
  );
}
