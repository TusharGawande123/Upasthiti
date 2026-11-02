// The result of a phone punch (spec M4b §4.11, design gate P2 screen 6): a big IN or OUT with the
// time and plant for an accepted punch (also a flagged one: other flags are never shown, as at the
// gate), or a card with the reason for a refusal. No sound, no voice. A "Back" button, no timer.
import { LogIn, LogOut } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PhonePunchAnswer } from "./phone-api";
import { CodedProblem } from "./phone-problem-views";
import { PhoneButton, PhoneCard } from "./phone-ui";

export function PunchResult({
  answer,
  plantName,
  onBack,
  onRetry,
}: {
  answer: PhonePunchAnswer;
  plantName: string;
  onBack: () => void;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  if (answer.decision === "rejected" || answer.direction === null) {
    return (
      <CodedProblem
        code={answer.reason_code ?? "INTERNAL_ERROR"}
        onRetry={answer.details.retry_allowed === false ? undefined : onRetry}
        onBack={onBack}
      />
    );
  }
  const isIn = answer.direction === "in";
  const Icon = isIn ? LogIn : LogOut;
  return (
    <PhoneCard
      role="status"
      className={cn(
        "space-y-3 border-0 text-center text-white",
        isIn ? "bg-[var(--flood-in)]" : "bg-[var(--flood-out)]",
      )}
    >
      <Icon className="mx-auto size-16" aria-hidden />
      <p className="text-6xl font-extrabold tracking-wide">{t(isIn ? "phone.in" : "phone.out")}</p>
      <p className="text-xl">
        {t("phone.result.serverTime")}{" "}
        <span className="font-bold">{formatTime(answer.punch_time)}</span>
      </p>
      <p className="text-xl">{plantName}</p>
      {answer.outside_plant ? (
        <p className="rounded-lg bg-white/15 p-3 text-lg font-semibold">
          {t("phone.punch.outsidePlantLine")}
        </p>
      ) : null}
      <PhoneButton variant="outline" onClick={onBack}>
        {t("phone.back")}
      </PhoneButton>
    </PhoneCard>
  );
}
