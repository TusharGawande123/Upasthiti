// Shows a pairing code to the admin: the 3 + 3 digits, a QR of the pairing link (F-18), a
// 10-minute countdown and the live result ("Waiting for the device…" -> "Paired ✓").
// The code works once; when it runs out the admin makes a new one.
import { Check, Copy, Loader2, RefreshCw, TimerOff } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { describeError } from "@/features/auth/error-message";
import { cn } from "@/lib/utils";
import { type KioskWithCode, useKiosks, useNewPairingCode } from "./use-kiosks";

const POLL_MS = 3000;

function secondsLeft(expiresAt: string, now: number): number {
  return Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000));
}

function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function CodeDigits({ code }: { code: string }) {
  return (
    <div className="flex gap-2" aria-label={code.split("").join(" ")} role="img">
      {code.split("").map((digit, index) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: six fixed boxes
          key={index}
          aria-hidden
          className={cn(
            "tnum grid h-14 w-11 place-items-center rounded-lg border bg-card text-3xl font-bold shadow-xs",
            index === 2 && "mr-3",
          )}
        >
          {digit}
        </span>
      ))}
    </div>
  );
}

type Props = {
  issued: KioskWithCode;
  plantLabel: string;
  onIssued: (next: KioskWithCode) => void;
};

export function PairingCodeView({ issued, plantLabel, onIssued }: Props) {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);
  const newCode = useNewPairingCode();
  const kioskId = issued.kiosk.id;
  const left = secondsLeft(issued.code_expires_at, now);
  const expired = left === 0;

  // The list refreshes every 3 s while the code is valid, to notice the device pairing.
  const kiosks = useKiosks(
    { plant_id: issued.kiosk.plant_id },
    { refetchMs: expired ? undefined : POLL_MS },
  );
  const paired = kiosks.data?.find((kiosk) => kiosk.id === kioskId)?.status === "active";

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const pairingAddress = `${window.location.origin}/kiosk`;

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(issued.pairing_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Copying can be blocked; the code is on screen anyway.
    }
  };

  if (paired) {
    return (
      <div className="space-y-4 text-center">
        <span className="mx-auto grid size-16 place-items-center rounded-full bg-success text-white">
          <Check className="size-9" strokeWidth={3} aria-hidden />
        </span>
        <p className="text-lg font-bold">{t("kiosks.code.paired", { name: issued.kiosk.name })}</p>
        <p className="text-sm text-muted-foreground">{t("kiosks.code.pairedText")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {newCode.error ? (
        <Alert tone="danger">
          <span>{describeError(newCode.error, t)}</span>
        </Alert>
      ) : null}
      <div className="grid gap-5 sm:grid-cols-[1fr_auto]">
        <div className="space-y-4">
          <div>
            <p className="mb-1 text-sm font-bold">{t("kiosks.code.step1")}</p>
            <p className="tnum rounded-md border border-dashed bg-primary-soft px-3 py-2 text-sm break-all">
              {pairingAddress}
            </p>
          </div>
          <div>
            <p className="mb-2 text-sm font-bold">{t("kiosks.code.step2")}</p>
            {expired ? (
              <Alert tone="warning">
                <TimerOff aria-hidden />
                <span>{t("kiosks.code.expired")}</span>
              </Alert>
            ) : (
              <div className="space-y-3">
                <CodeDigits code={issued.pairing_code} />
                <Button size="sm" onClick={copyCode}>
                  {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                  {copied ? t("common.copied") : t("common.copy")}
                </Button>
                <p className="tnum text-sm">
                  <b className="text-xl">{formatCountdown(left)}</b> {t("kiosks.code.left")}
                  <span className="block text-muted-foreground">{t("kiosks.code.worksOnce")}</span>
                </p>
              </div>
            )}
          </div>
        </div>
        {!expired ? (
          <figure className="mx-auto w-44 rounded-lg border bg-white p-2 text-center">
            <img
              src={`/api/v1/kiosks/${kioskId}/pairing-qr.svg?code=${issued.pairing_code}`}
              alt={t("kiosks.code.qrAlt", { name: issued.kiosk.name })}
              className="size-40"
            />
            <figcaption className="mt-1 text-xs text-muted-foreground">
              {t("kiosks.code.qrText")}
            </figcaption>
          </figure>
        ) : null}
      </div>

      {!expired ? (
        <Alert tone="info" className="items-center">
          <Loader2 className="animate-spin" aria-hidden />
          <span>
            <b>{t("kiosks.code.waiting")}</b> {t("kiosks.code.waitingText", { plant: plantLabel })}
          </span>
        </Alert>
      ) : null}

      <Button
        variant="outline"
        disabled={newCode.isPending}
        onClick={() => newCode.mutate(kioskId, { onSuccess: onIssued })}
      >
        <RefreshCw aria-hidden />
        {t("kiosks.code.makeNew")}
      </Button>
    </div>
  );
}
