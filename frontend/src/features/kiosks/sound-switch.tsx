// The per-gate sound switch (F-1) and the last self-test (F-27) shown on the kiosks list and in
// a plant's kiosks tab (spec M2 §4.12, design gate C). Switching sound off silences tones AND
// the spoken line at that gate; the kiosk still shows every result. A role that may not change it
// (the Corporate Head) sees the state as words. Status is never colour alone: icon + word.
import { CircleCheck, CircleDashed, Volume2, VolumeX } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { describeError } from "@/features/auth/error-message";
import { formatDate, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { type Kiosk, useSetKioskSound } from "./use-kiosks";

export function SoundSwitch({ kiosk, canManage }: { kiosk: Kiosk; canManage: boolean }) {
  const { t } = useTranslation();
  const setSound = useSetKioskSound();
  if (kiosk.status === "revoked") return <span className="text-muted-foreground">–</span>;
  const on = !kiosk.sound_muted;
  const Icon = on ? Volume2 : VolumeX;
  const words = (
    <span className="flex items-center gap-1.5 text-sm font-semibold">
      <Icon className="size-4" aria-hidden />
      {on ? t("kiosks.sound.on") : t("kiosks.sound.off")}
    </span>
  );
  if (!canManage) return words;
  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={t("kiosks.sound.for", { name: kiosk.name })}
        disabled={setSound.isPending}
        onClick={() =>
          setSound.mutate(
            { id: kiosk.id, sound_muted: on },
            { onError: (error) => toast.error(describeError(error, t)) },
          )
        }
        className={cn(
          "relative h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 transition-colors disabled:opacity-60",
          on ? "border-primary bg-primary" : "border-input bg-muted",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "absolute top-0.5 size-4 rounded-full bg-white shadow transition-transform",
            on ? "translate-x-5" : "translate-x-0.5 bg-input",
          )}
        />
      </button>
      {words}
    </span>
  );
}

export function LastSelfTest({ kiosk }: { kiosk: Kiosk }) {
  const { t } = useTranslation();
  if (kiosk.status !== "active") return <span className="text-muted-foreground">–</span>;
  if (!kiosk.last_self_test_at) {
    return (
      <span className="flex items-center gap-1.5 text-sm font-semibold text-warning">
        <CircleDashed className="size-4" aria-hidden />
        {t("kiosks.selfTest.never")}
      </span>
    );
  }
  return (
    <span className="tnum flex items-center gap-1.5 text-sm">
      <CircleCheck className="size-4 text-success" aria-hidden />
      {formatDate(kiosk.last_self_test_at)} {formatTime(kiosk.last_self_test_at)}
    </span>
  );
}
