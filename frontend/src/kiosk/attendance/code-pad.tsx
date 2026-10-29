// The employee code pad (spec M3 §4.5, design gate A, mockup 05): shown when the server could not be
// sure whose face it was and asks for the employee code, a 1:1 check against the face. Big keys,
// digits first and letters on a second page, one-tap keys for the common starts of the plant's
// codes (decision 0019). The name is never shown here. The pad stays on the screen while the code
// is checked, so a wrong code can be corrected without typing everything again.
import { OFFLINE_ENTRY_TOKEN } from "./use-face-punch";
import "@fontsource/jetbrains-mono/latin-600.css";
import { Check, Delete, Hash, Info, Loader2, Type, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { KioskButton } from "../components/kiosk-button";
import type { CodeEntry } from "./punch-types";

const MAX_CODE_LENGTH = 12; // employee codes are 1 to 12 characters (M1)
const DIGIT_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
const LETTER_KEYS = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ", "-", "/"];
const CODE_FONT = '"JetBrains Mono", ui-monospace, "Cascadia Mono", Consolas, monospace';

function Key({ className, ...props }: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={cn(
        "grid min-h-16 min-w-0 cursor-pointer place-items-center rounded-2xl border-[3px] border-foreground bg-card text-[32px] font-extrabold text-foreground shadow-[0_4px_0_0_#0e1726] transition active:translate-y-[2px] active:shadow-none disabled:cursor-not-allowed disabled:border-dashed disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none",
        className,
      )}
      {...props}
    />
  );
}

// The countdown ring: the share of the code time that is left.
function Ring({ seconds, total }: { seconds: number; total: number }) {
  const { t } = useTranslation();
  const share = Math.max(0, Math.min(1, seconds / Math.max(total, 1)));
  const circumference = 2 * Math.PI * 42;
  return (
    <div
      role="timer"
      aria-label={t("kiosk.codePad.secondsLeft", { count: Math.max(seconds, 0) })}
      className="relative grid size-20 shrink-0 place-items-center sm:size-24"
    >
      <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx="50" cy="50" r="42" fill="none" stroke="#e3e8f2" strokeWidth="10" />
        <circle
          cx="50"
          cy="50"
          r="42"
          fill="none"
          stroke={seconds <= 15 ? "#8a1a10" : "#1f3a93"}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - share)}
        />
      </svg>
      <span aria-hidden className="tnum relative text-[22px] font-extrabold sm:text-[26px]">
        {Math.max(seconds, 0)} s
      </span>
    </div>
  );
}

export function CodePad({
  entry,
  wrong,
  checking,
  slow,
  prefixes,
  totalSeconds,
  serverOffsetMs,
  onSubmit,
  onCancel,
  onExpired,
}: {
  entry: CodeEntry;
  /** The last try did not match the face: say so and show the tries left. */
  wrong: boolean;
  checking: boolean;
  slow: boolean;
  prefixes: string[];
  totalSeconds: number;
  serverOffsetMs: number;
  onSubmit: (code: string) => void;
  onCancel: () => void;
  onExpired: () => void;
}) {
  const { t } = useTranslation();
  // Offline (M4 §4.4) the pad comes first, before any face: it asks for the code in plain words.
  const offline = entry.token === OFFLINE_ENTRY_TOKEN;
  const [code, setCode] = useState("");
  const [letters, setLetters] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const secondsLeft = Math.ceil((Date.parse(entry.expires_at) - (now + serverOffsetMs)) / 1000);
  useEffect(() => {
    if (secondsLeft <= 0 && !checking) onExpired();
  }, [secondsLeft, checking, onExpired]);

  const press = useCallback((text: string) => {
    setCode((current) => (current + text).slice(0, MAX_CODE_LENGTH));
  }, []);
  const erase = useCallback(() => setCode((current) => current.slice(0, -1)), []);
  const submit = useCallback(() => {
    if (code !== "" && !checking) onSubmit(code);
  }, [code, checking, onSubmit]);

  // A gate PC with a keyboard can type the code too.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (checking) return;
      if (event.key === "Enter") submit();
      else if (event.key === "Backspace") erase();
      else if (event.key === "Escape") onCancel();
      else if (/^[0-9A-Za-z/-]$/.test(event.key)) press(event.key.toUpperCase());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [checking, submit, erase, press, onCancel]);

  return (
    <div className="kiosk-theme fixed inset-0 z-20 flex flex-col overflow-y-auto bg-background">
      <div
        aria-hidden
        className="h-3 shrink-0 bg-[repeating-linear-gradient(135deg,var(--signal)_0_18px,#0f172a_18px_36px)]"
      />
      <div className="mx-auto flex w-full max-w-[720px] flex-1 flex-col gap-3 px-4 py-4 sm:px-8">
        <div className="flex items-center gap-4">
          <span className="grid size-16 shrink-0 place-items-center rounded-2xl border-4 border-[#5a3b00] bg-[var(--flood-already)] text-foreground sm:size-20">
            <Info className="size-10 sm:size-12" aria-hidden />
          </span>
          <h1 className="text-[32px] leading-tight font-extrabold tracking-tight sm:text-[40px]">
            {t(offline ? "kiosk.offline.typeCodeTitle" : "kiosk.punch.NEED_EMPLOYEE_CODE.title")}
          </h1>
        </div>
        <p className="text-[26px] leading-snug">
          {t(offline ? "kiosk.offline.typeCodeLine" : "kiosk.codePad.subtitle")}
        </p>

        <div className="flex items-center gap-3">
          <output
            aria-label={t("kiosk.codePad.typed")}
            aria-live="polite"
            className={cn(
              "flex min-h-20 min-w-0 flex-1 items-center overflow-hidden rounded-2xl border-4 border-foreground bg-card px-4 font-semibold tracking-[0.08em] sm:px-5 sm:tracking-[0.12em]",
              // Long codes get smaller letters, so the whole code stays visible on a phone.
              code.length > 8 ? "text-[26px] sm:text-[40px]" : "text-[34px] sm:text-[44px]",
            )}
            style={{ fontFamily: CODE_FONT, fontFeatureSettings: '"zero"' }}
          >
            <span className="truncate">{code}</span>
            <span
              aria-hidden
              className="ml-1 h-12 w-1 shrink-0 bg-primary motion-safe:animate-pulse"
            />
          </output>
          <Ring seconds={secondsLeft} total={totalSeconds} />
        </div>

        {wrong ? (
          <p
            role="alert"
            className="flex items-start gap-3 rounded-2xl border-4 border-[var(--flood-reject)] bg-[#ffe9e6] px-4 py-3 text-[26px] leading-snug font-bold text-[var(--flood-reject)]"
          >
            <X className="mt-1 size-8 shrink-0" aria-hidden />
            <span>
              {t("kiosk.punch.CODE_NOT_MATCHED.message")}{" "}
              <span className="inline-block rounded-full border-2 border-current px-3 text-[24px]">
                {t("kiosk.codePad.triesLeft", { count: entry.tries_left })}
              </span>
            </span>
          </p>
        ) : null}
        {checking ? (
          <p role="status" className="flex items-center gap-3 text-[26px] font-bold text-primary">
            <Loader2 className="size-8 animate-spin" aria-hidden />
            {slow ? t("kiosk.attendance.serverWaking") : t("kiosk.attendance.checking")}
          </p>
        ) : null}

        <div className="grid grid-cols-[1fr_1.4fr] gap-3">
          <KioskButton
            variant="key"
            className="border-[3px] border-foreground px-2 text-[26px] sm:text-[28px]"
            disabled={checking}
            onClick={onCancel}
          >
            <X className="hidden size-7 sm:block" aria-hidden />
            {t("kiosk.face.cancel")}
          </KioskButton>
          <fieldset className="grid grid-cols-2 overflow-hidden rounded-2xl border-[3px] border-foreground">
            <legend className="sr-only">{t("kiosk.codePad.keys")}</legend>
            {[false, true].map((showLetters) => (
              <button
                key={String(showLetters)}
                type="button"
                aria-pressed={letters === showLetters}
                onClick={() => setLetters(showLetters)}
                className={cn(
                  "flex min-h-16 cursor-pointer items-center justify-center gap-2 text-[24px] font-extrabold sm:text-[26px]",
                  letters === showLetters ? "bg-foreground text-white" : "bg-card text-foreground",
                )}
              >
                {showLetters ? (
                  <Type className="hidden size-6 sm:block" aria-hidden />
                ) : (
                  <Hash className="hidden size-6 sm:block" aria-hidden />
                )}
                {t(showLetters ? "kiosk.codePad.letters" : "kiosk.codePad.numbers")}
              </button>
            ))}
          </fieldset>
        </div>

        {prefixes.length > 0 ? (
          <fieldset className="flex flex-wrap gap-3">
            <legend className="sr-only">{t("kiosk.codePad.starts")}</legend>
            {prefixes.map((prefix) => (
              <Key
                key={prefix}
                className="min-w-24 flex-1 px-3 text-[28px]"
                style={{ fontFamily: CODE_FONT }}
                disabled={checking}
                onClick={() => press(prefix)}
              >
                {prefix}
              </Key>
            ))}
          </fieldset>
        ) : null}

        {letters ? (
          <div className="grid grid-cols-7 gap-2">
            {LETTER_KEYS.map((key) => (
              <Key
                key={key}
                className="px-0 text-[28px]"
                disabled={checking}
                onClick={() => press(key)}
              >
                {key}
              </Key>
            ))}
            <DeleteKey className="col-span-3" onClick={erase} disabled={checking || code === ""} />
            <OkKey
              className="col-span-4"
              checking={checking}
              disabled={code === "" || checking}
              onClick={submit}
            />
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {DIGIT_KEYS.map((key) => (
              <Key key={key} disabled={checking} onClick={() => press(key)}>
                {key}
              </Key>
            ))}
            <DeleteKey onClick={erase} disabled={checking || code === ""} stacked />
            <Key disabled={checking} onClick={() => press("0")}>
              0
            </Key>
            <OkKey checking={checking} disabled={code === "" || checking} onClick={submit} />
          </div>
        )}
      </div>
    </div>
  );
}

function DeleteKey({
  className,
  stacked,
  ...props
}: React.ComponentProps<"button"> & { stacked?: boolean }) {
  const { t } = useTranslation();
  return (
    <Key
      className={cn(
        "bg-muted text-[24px]",
        stacked ? "grid-flow-row content-center gap-0" : "grid-flow-col gap-2",
        className,
      )}
      aria-label={t("kiosk.codePad.deleteLong")}
      {...props}
    >
      <Delete className="size-8" aria-hidden />
      <span>{t("kiosk.codePad.delete")}</span>
    </Key>
  );
}

function OkKey({
  className,
  checking,
  ...props
}: React.ComponentProps<"button"> & { checking: boolean }) {
  const { t } = useTranslation();
  return (
    <Key
      className={cn(
        "grid-flow-col gap-2 border-[var(--flood-in-dark)] bg-[var(--flood-in)] text-white shadow-[0_4px_0_0_var(--flood-in-dark)]",
        className,
      )}
      {...props}
    >
      {checking ? (
        <Loader2 className="size-8 animate-spin" aria-hidden />
      ) : (
        <Check className="size-8" aria-hidden />
      )}
      {t("kiosk.codePad.ok")}
    </Key>
  );
}
