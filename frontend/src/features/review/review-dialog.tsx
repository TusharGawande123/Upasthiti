// The review dialogs (spec M4 §4.8 actions, §7 rule 7, design gate B 03-dialogs): Confirm,
// Not accepted, Approve and Change review. The server decides again what is allowed; the dialog
// only offers what fits the punch. A review is never edited: "Change review" adds a new one.
import { CircleCheck, CircleX, LogIn, LogOut, RefreshCw, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { describeError } from "@/features/auth/error-message";
import { ApiError } from "@/lib/api-client";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { type ReviewAction, type ReviewContext, useReviewPunch } from "./use-review";

export type DialogMode = "confirm" | "not_accepted" | "approve" | "change";

const MIN_REASON = 3;
const MAX_REASON = 300;

/** What a "Change review" may turn into: the actions that fit the punch's decision. */
export function changeChoices(context: ReviewContext): ReviewAction[] {
  if (context.punch.decision === "flagged") return ["confirm", "not_accepted"];
  // A rejected punch: approve again (other direction) or withdraw the approval.
  return ["approve", "not_accepted"];
}

function RadioCard({
  name,
  value,
  checked,
  onChange,
  title,
  help,
  badge,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  title: string;
  help?: string;
  badge?: string;
}) {
  return (
    <label
      className={cn(
        "flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary/40",
        checked && "border-primary bg-primary-soft",
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        className="mt-1 size-4 accent-[var(--primary)]"
      />
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-2 font-semibold">
          {title}
          {badge ? (
            <span className="rounded-full bg-signal px-2 py-0.5 text-xs font-bold text-foreground">
              {badge}
            </span>
          ) : null}
        </span>
        {help ? <span className="block text-sm text-muted-foreground">{help}</span> : null}
      </span>
    </label>
  );
}

export function ReviewDialog({
  mode,
  context,
  onClose,
  onSaved,
  onReload,
}: {
  mode: DialogMode;
  context: ReviewContext;
  onClose: () => void;
  onSaved: (action: ReviewAction) => void;
  onReload: () => void;
}) {
  const { t } = useTranslation();
  const save = useReviewPunch();
  const latest = context.reviews[0] ?? null;
  const [action, setAction] = useState<ReviewAction>(
    mode === "change" ? (changeChoices(context)[0] as ReviewAction) : mode,
  );
  const [direction, setDirection] = useState<"in" | "out">(
    context.suggestion?.direction ?? latest?.direction ?? "in",
  );
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);

  const needsReason = action !== "confirm";
  const trimmed = reason.trim();
  const reasonProblem =
    trimmed.length > MAX_REASON
      ? t("review.dialog.reasonTooLong")
      : needsReason && trimmed.length < MIN_REASON
        ? t("review.dialog.reasonTooShort")
        : null;
  const changed = save.error instanceof ApiError && save.error.code === "REVIEW_CHANGED";
  const nearby = context.nearby_counted;

  const submit = () => {
    setTouched(true);
    if (reasonProblem) return;
    save.mutate(
      {
        punchId: context.punch.id,
        action,
        reason: trimmed || undefined,
        direction: action === "approve" ? direction : undefined,
        expected_latest_review_id: latest?.id ?? null,
      },
      { onSuccess: () => onSaved(action) },
    );
  };

  const title = t(`review.dialog.title.${mode}`);
  const primaryText =
    action === "approve"
      ? t("review.dialog.approveAs", { direction: t(`punches.direction.${direction}`) })
      : t(`review.dialog.button.${action}`);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[540px] max-sm:h-dvh max-sm:max-h-dvh max-sm:w-full max-sm:max-w-none max-sm:rounded-none">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{t(`review.dialog.description.${mode}`)}</DialogDescription>

        {changed ? (
          <Alert tone="danger" className="mt-4">
            <TriangleAlert aria-hidden />
            <span>{t("errors.REVIEW_CHANGED")}</span>
          </Alert>
        ) : null}

        <div className="mt-4 space-y-4">
          {mode === "change" && latest ? (
            <p className="rounded-lg bg-muted px-3 py-2 text-sm">
              {t("review.dialog.now", { action: t(`review.action.${latest.action}`) })}
            </p>
          ) : null}

          {mode === "change" ? (
            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-semibold">
                {t("review.dialog.newDecision")}
              </legend>
              {changeChoices(context).map((choice) => (
                <RadioCard
                  key={choice}
                  name="review-action"
                  value={choice}
                  checked={action === choice}
                  onChange={() => setAction(choice)}
                  title={t(`review.dialog.choice.${choice}`)}
                />
              ))}
            </fieldset>
          ) : null}

          {action === "approve" ? (
            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-semibold">{t("review.dialog.countAs")}</legend>
              {(["in", "out"] as const).map((choice) => (
                <RadioCard
                  key={choice}
                  name="review-direction"
                  value={choice}
                  checked={direction === choice}
                  onChange={() => setDirection(choice)}
                  title={t(`review.dialog.countAs_${choice}`)}
                  help={t(`review.dialog.countAsHelp_${choice}`)}
                  badge={
                    context.suggestion?.direction === choice
                      ? t("review.dialog.suggested")
                      : undefined
                  }
                />
              ))}
              {nearby.map((other) => (
                <Alert key={other.punch_id} tone="warning">
                  <TriangleAlert aria-hidden />
                  <span>
                    {t("review.dialog.nearby", {
                      direction: t(`punches.direction.${other.direction}`),
                      time: formatTime(other.punch_time),
                    })}{" "}
                    {t("review.dialog.nearbyHelp")}
                  </span>
                </Alert>
              ))}
            </fieldset>
          ) : null}

          <div>
            <Label htmlFor="review-reason">
              {needsReason ? t("review.dialog.reason") : t("review.dialog.note")}
              {needsReason ? (
                <span aria-hidden className="text-destructive">
                  {" "}
                  *
                </span>
              ) : (
                <span className="font-normal text-muted-foreground">
                  {" "}
                  {t("review.dialog.optional")}
                </span>
              )}
              {needsReason ? <span className="sr-only"> {t("review.dialog.required")}</span> : null}
            </Label>
            <textarea
              id="review-reason"
              value={reason}
              maxLength={MAX_REASON + 50}
              rows={3}
              aria-invalid={touched && reasonProblem ? true : undefined}
              aria-describedby="review-reason-help"
              onChange={(event) => setReason(event.target.value)}
              className={cn(
                "mt-1 w-full rounded-md border border-input bg-card px-3 py-2 text-[15px] shadow-xs",
                touched && reasonProblem && "border-destructive",
              )}
            />
            <p
              id="review-reason-help"
              className={cn(
                "mt-1 flex justify-between gap-2 text-[13px]",
                touched && reasonProblem ? "text-destructive" : "text-muted-foreground",
              )}
            >
              <span>
                {touched && reasonProblem ? reasonProblem : t("review.dialog.reasonHelp")}
              </span>
              <span className="tnum">
                {trimmed.length} / {MAX_REASON}
              </span>
            </p>
          </div>

          {action === "not_accepted" ? (
            <Alert tone="danger">
              <CircleX aria-hidden />
              <span>{t("review.dialog.stopsCounting")}</span>
            </Alert>
          ) : null}

          {save.isError && !changed ? (
            <Alert tone="danger">
              <TriangleAlert aria-hidden />
              <span>{describeError(save.error, t)}</span>
            </Alert>
          ) : null}
        </div>

        <DialogFooter className="max-sm:flex-col-reverse">
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          {changed ? (
            <Button onClick={onReload}>
              <RefreshCw aria-hidden />
              {t("review.dialog.loadLatest")}
            </Button>
          ) : (
            <Button
              variant={action === "not_accepted" ? "danger" : "primary"}
              onClick={submit}
              disabled={save.isPending}
              aria-busy={save.isPending}
            >
              {action === "not_accepted" ? <CircleX aria-hidden /> : null}
              {action === "confirm" ? <CircleCheck aria-hidden /> : null}
              {action === "approve" ? (
                direction === "in" ? (
                  <LogIn aria-hidden />
                ) : (
                  <LogOut aria-hidden />
                )
              ) : null}
              {save.isPending ? t("review.dialog.saving") : primaryText}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
