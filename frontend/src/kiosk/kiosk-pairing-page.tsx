// The /kiosk page: pairs this device to a plant gate, then shows the attendance screen. Designed for a phone, tablet or
// PC fixed at the gate: text is at least 24 px, tap targets are large, every status has an
// icon AND words, and the screen never needs scrolling (NFR-06, design gate C).
import {
  Ban,
  Check,
  CircleDashed,
  CircleX,
  Delete,
  Keyboard,
  Link2,
  Loader2,
  LocateFixed,
  type LucideIcon,
  MapPin,
  MapPinOff,
  MapPinX,
  MonitorX,
  RotateCw,
  SatelliteDish,
  ShieldAlert,
  TimerOff,
  WifiOff,
  X,
} from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { AttendanceScreen } from "./attendance/attendance-screen";
import { Frame } from "./components/frame";
import { KioskButton } from "./components/kiosk-button";
import { ProblemScreen } from "./components/problem-screen";
import { StatusChip } from "./components/status-chip";
import { CODE_LENGTH, type PairingProblem, type PairingState, usePairing } from "./use-pairing";

// Only the mark drawn on the accuracy meter. The server setting (default 50 m, Super Admin can
// change it) decides for real and says its limit when it refuses.
const GOOD_ENOUGH_M = 50;

function DigitBoxes({ code, wrong }: { code: string; wrong: boolean }) {
  const { t } = useTranslation();
  return (
    <fieldset className="m-0 flex w-full items-center justify-center gap-2 border-0 p-0 sm:gap-4">
      <legend className="sr-only">{t("kiosk.pairing.codeLabel")}</legend>
      {Array.from({ length: CODE_LENGTH }, (_, index) => {
        const digit = code[index];
        const isNext = index === code.length;
        return (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: six fixed boxes
            key={index}
            className={cn(
              // The boxes shrink to fit a narrow phone (about 50 px each at 360 px) and stop growing at 78 px.
              "grid h-[84px] max-w-[78px] min-w-0 flex-1 place-items-center rounded-2xl border-2 bg-card text-[44px] leading-none font-bold tabular-nums shadow-sm sm:h-[104px] sm:text-[64px]",
              index === 2 && "mr-3 sm:mr-5",
              isNext && "border-signal ring-4 ring-signal/40",
              wrong && "border-destructive",
            )}
          >
            {digit ?? ""}
          </span>
        );
      })}
    </fieldset>
  );
}

function Keypad({
  onDigit,
  onBackspace,
  onClear,
}: {
  onDigit: (digit: string) => void;
  onBackspace: () => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-3 gap-3">
      {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
        <KioskButton
          key={digit}
          variant="key"
          className="text-[44px]"
          onClick={() => onDigit(digit)}
        >
          {digit}
        </KioskButton>
      ))}
      <KioskButton variant="key" className="text-[26px]" onClick={onClear}>
        <X className="size-7" aria-hidden />
        {t("kiosk.pairing.clear")}
      </KioskButton>
      <KioskButton variant="key" className="text-[44px]" onClick={() => onDigit("0")}>
        0
      </KioskButton>
      <KioskButton variant="key" className="text-[26px]" onClick={onBackspace}>
        <Delete className="size-7" aria-hidden />
        {t("kiosk.pairing.back")}
      </KioskButton>
    </div>
  );
}

function EnterScreen({
  code,
  wrong,
  fromLink,
  onDigit,
  onBackspace,
  onClear,
  onSubmit,
}: {
  code: string;
  wrong: boolean;
  fromLink: boolean;
  onDigit: (digit: string) => void;
  onBackspace: () => void;
  onClear: () => void;
  onSubmit: () => void;
}) {
  const { t } = useTranslation();
  const complete = code.length === CODE_LENGTH;

  // A PC at the gate may have a keyboard: digits, Backspace and Enter work too.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (/^[0-9]$/.test(event.key)) onDigit(event.key);
      else if (event.key === "Backspace") onBackspace();
      else if (event.key === "Enter" && complete) onSubmit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [complete, onDigit, onBackspace, onSubmit]);

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-8 lg:grid-cols-2 lg:items-center">
      <div className="space-y-6">
        <div>
          <h1 className="text-[40px] leading-tight font-extrabold tracking-tight sm:text-[56px]">
            {t("kiosk.pairing.title")}
          </h1>
          <p className="mt-2 text-[24px] text-foreground/80 sm:text-[28px]">
            {t("kiosk.pairing.instruction")}
          </p>
          {fromLink ? (
            <p className="mt-3 flex items-center gap-2 text-[24px] font-semibold text-success">
              <Check className="size-6" aria-hidden />
              {t("kiosk.pairing.filledFromLink")}
            </p>
          ) : null}
        </div>
        <DigitBoxes code={code} wrong={wrong} />
        {wrong ? (
          <p
            role="alert"
            className="flex items-center justify-center gap-2 text-[26px] font-bold text-destructive"
          >
            <CircleX className="size-7" aria-hidden />
            {t("kiosk.pairing.wrongCode")}
          </p>
        ) : null}
        <div className="flex items-start gap-4 rounded-2xl border bg-card p-5">
          <span className="grid size-14 shrink-0 place-items-center rounded-xl bg-signal text-foreground">
            <MapPin className="size-8" aria-hidden />
          </span>
          <p className="text-[24px] leading-snug">
            <b className="block text-[28px]">{t("kiosk.pairing.locationTitle")}</b>
            {t("kiosk.pairing.locationText")}
          </p>
        </div>
      </div>
      <div className="space-y-4">
        <Keypad onDigit={onDigit} onBackspace={onBackspace} onClear={onClear} />
        <KioskButton className="w-full" disabled={!complete} onClick={onSubmit}>
          <Link2 className="size-8" aria-hidden />
          {complete ? t("kiosk.pairing.pair") : t("kiosk.pairing.typeAll", { count: CODE_LENGTH })}
        </KioskButton>
      </div>
    </div>
  );
}

function AccuracyMeter({ best }: { best: number | null }) {
  const { t } = useTranslation();
  // Scale: 200 m on the left (bad) to 5 m on the right (best).
  const share = best === null ? 0 : Math.max(4, Math.min(100, ((200 - best) / 195) * 100));
  const neededAt = ((200 - GOOD_ENOUGH_M) / 195) * 100;
  return (
    <div className="mx-auto w-full max-w-xl" aria-hidden>
      <div className="relative h-5 overflow-hidden rounded-full border bg-card">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${share}%` }}
        />
        <div className="absolute inset-y-0 w-1 bg-foreground" style={{ left: `${neededAt}%` }} />
      </div>
      <div className="mt-2 flex justify-between text-[24px] text-muted-foreground">
        <span>{t("kiosk.pairing.scaleWorst")}</span>
        <b className="text-foreground">{t("kiosk.pairing.needed", { metres: GOOD_ENOUGH_M })}</b>
        <span>{t("kiosk.pairing.scaleBest")}</span>
      </div>
    </div>
  );
}

function BusyScreen({
  phase,
  accuracyM,
}: {
  phase: "locating" | "checking";
  accuracyM: number | null;
}) {
  const { t } = useTranslation();
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-6 text-center">
      <span className="grid size-36 place-items-center rounded-full bg-primary-soft text-primary-soft-foreground">
        <LocateFixed className="size-20" aria-hidden />
      </span>
      <h1 className="text-[48px] leading-tight font-extrabold">
        {t(phase === "locating" ? "kiosk.pairing.locatingTitle" : "kiosk.pairing.checkingTitle")}
      </h1>
      <div role="status" aria-live="polite" className="space-y-1">
        {phase === "locating" ? (
          <>
            <p className="tnum text-[64px] leading-none font-extrabold">
              {accuracyM === null ? "…" : t("kiosk.pairing.accuracyValue", { metres: accuracyM })}
            </p>
            <p className="text-[24px] text-muted-foreground">
              {t("kiosk.pairing.accuracyNow", { metres: GOOD_ENOUGH_M })}
            </p>
          </>
        ) : (
          <p className="flex items-center justify-center gap-3 text-[28px] font-semibold text-primary">
            <Loader2 className="size-8 animate-spin" aria-hidden />
            {t("kiosk.pairing.checkingText")}
          </p>
        )}
      </div>
      {phase === "locating" ? <AccuracyMeter best={accuracyM} /> : null}
    </div>
  );
}

const PROBLEM_ICONS: Record<PairingProblem, LucideIcon> = {
  "code-expired": TimerOff,
  locked: ShieldAlert,
  "location-off": MapPinOff,
  "gps-weak": SatelliteDish,
  outside: MapPinX,
  unsupported: MonitorX,
  revoked: Ban,
  network: WifiOff,
  unknown: CircleX,
};

// Problems the admin must fix: the red tone. The others the worker can fix: the amber tone.
const SERIOUS_PROBLEMS = new Set<PairingProblem>([
  "locked",
  "outside",
  "unsupported",
  "revoked",
  "unknown",
]);
// Problems that have no button (nothing to press on this device).
const NO_ACTION = new Set<PairingProblem>(["unsupported"]);

function PairingProblemScreen({
  state,
  onAction,
}: {
  state: Extract<PairingState, { phase: "problem" }>;
  onAction: (problem: PairingProblem) => void;
}) {
  const { t } = useTranslation();
  const { problem } = state;
  const startsOver = problem === "code-expired" || problem === "locked" || problem === "revoked";

  return (
    <ProblemScreen
      icon={PROBLEM_ICONS[problem]}
      serious={SERIOUS_PROBLEMS.has(problem)}
      title={t(`kiosk.problem.${problem}.title`)}
      message={t(`kiosk.problem.${problem}.message`)}
      steps={t(`kiosk.problem.${problem}.steps`, { returnObjects: true }) as string[]}
      extra={
        problem === "gps-weak" && state.bestAccuracyM !== null ? (
          <p className="tnum text-[28px] font-bold">
            {t("kiosk.problem.gps-weak.best", { metres: state.bestAccuracyM })}
          </p>
        ) : null
      }
      action={
        NO_ACTION.has(problem)
          ? undefined
          : {
              label: t(startsOver ? "kiosk.problem.newCode" : "kiosk.problem.tryAgain"),
              icon: startsOver ? Keyboard : RotateCw,
              onClick: () => onAction(problem),
            }
      }
      code={state.code}
    />
  );
}

function PairingStatusChip({ paired }: { paired: boolean }) {
  const { t } = useTranslation();
  return paired ? (
    <StatusChip tone="success" icon={Check}>
      {t("kiosk.chip.paired")}
    </StatusChip>
  ) : (
    <StatusChip tone="neutral" icon={CircleDashed}>
      {t("kiosk.chip.notPaired")}
    </StatusChip>
  );
}

export function KioskPairingPage() {
  const { t } = useTranslation();
  const pairing = usePairing();
  const { state } = pairing;

  // Once paired, the kiosk goes straight to scanning (zero taps, spec M2 §4.1).
  if (state.phase === "paired") {
    return (
      <AttendanceScreen
        kiosk={state.kiosk}
        initialMe={state.me}
        initialOffsetMs={state.serverOffsetMs}
        onRevoked={pairing.markRevoked}
        onUnpaired={pairing.startOver}
      />
    );
  }

  return (
    <Frame
      title={t("kiosk.brand")}
      subtitle={t("kiosk.subtitle")}
      aside={<PairingStatusChip paired={false} />}
    >
      {state.phase === "starting" ? (
        <Loader2 className="mx-auto size-16 animate-spin text-primary" aria-hidden />
      ) : null}
      {state.phase === "enter" ? (
        <EnterScreen
          code={pairing.code}
          wrong={state.wrongCode}
          fromLink={pairing.codeFromLink}
          onDigit={pairing.typeDigit}
          onBackspace={pairing.backspace}
          onClear={pairing.clear}
          onSubmit={pairing.submit}
        />
      ) : null}
      {state.phase === "locating" ? (
        <BusyScreen phase="locating" accuracyM={state.accuracyM} />
      ) : null}
      {state.phase === "checking" ? <BusyScreen phase="checking" accuracyM={null} /> : null}
      {state.phase === "problem" ? (
        <PairingProblemScreen state={state} onAction={pairing.tryAgain} />
      ) : null}
    </Frame>
  );
}
