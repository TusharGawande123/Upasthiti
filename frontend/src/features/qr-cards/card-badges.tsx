// Small pieces to show a card's state. Status is never shown by colour alone: every badge has
// an icon AND a word (design gate A).
import {
  Ban,
  CalendarClock,
  CircleCheck,
  CircleDashed,
  Printer,
  TimerOff,
  TriangleAlert,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { todayIst } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Card, CardState } from "./use-qr-cards";

const STATE_LOOK: Record<
  CardState,
  {
    icon: typeof Ban;
    tone: "neutral" | "primary" | "success" | "warning" | "danger";
    dashed?: true;
  }
> = {
  none: { icon: CircleDashed, tone: "neutral", dashed: true },
  active: { icon: CircleCheck, tone: "success" },
  expiring: { icon: TriangleAlert, tone: "warning" },
  not_yet_valid: { icon: CalendarClock, tone: "primary" },
  expired: { icon: TimerOff, tone: "neutral" },
  revoked: { icon: Ban, tone: "danger" },
};

export function CardStateBadge({ state }: { state: CardState }) {
  const { t } = useTranslation();
  const { icon: Icon, tone, dashed } = STATE_LOOK[state];
  return (
    <Badge tone={tone} className={cn(dashed && "border border-dashed border-border-strong")}>
      <Icon aria-hidden />
      {t(`qrCards.state.${state}`)}
    </Badge>
  );
}

/** Amber note: the employee moved plants after this card was printed, so a reprint is advised. */
export function ReprintBadge({ card }: { card: Card }) {
  const { t } = useTranslation();
  if (!card.reprint_needed) return null;
  return (
    <Badge tone="warning" className="whitespace-normal">
      <Printer aria-hidden />
      {t("qrCards.reprintNeeded", { plant: card.printed_plant?.code ?? "?" })}
    </Badge>
  );
}

/** Whole days from `from` to `to`, both "YYYY-MM-DD" (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  const day = 24 * 60 * 60 * 1000;
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / day);
}

/** The small line under "Valid until": how far away the end (or the start) is. */
export function useValidityHint(card: Card): string | null {
  const { t } = useTranslation();
  const today = todayIst();
  if (card.state === "revoked") return null;
  if (card.state === "not_yet_valid") {
    return t("qrCards.relative.startsIn", { count: daysBetween(today, card.valid_from) });
  }
  const left = daysBetween(today, card.valid_until);
  if (left < 0) return t("qrCards.relative.ago", { count: -left });
  if (left === 0) return t("qrCards.relative.today");
  return t("qrCards.relative.in", { count: left });
}
