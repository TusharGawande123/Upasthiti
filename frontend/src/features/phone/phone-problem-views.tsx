// The cards a phone page shows when something does not work: a coded problem (from the server or
// the phone) and a camera problem. Words come from `phone.punch.<CODE>.*` and `phone.camera.*`.
import { CameraOff, VideoOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CameraStatus } from "./phone-camera-hooks";
import { lookFor } from "./phone-problems";
import { PhoneButton, ProblemCard } from "./phone-ui";

export function CodedProblem({
  code,
  onRetry,
  onBack,
}: {
  code: string;
  onRetry?: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const look = lookFor(code);
  const next = t(`phone.punch.${look.code}.next`, { defaultValue: "" });
  return (
    <ProblemCard
      icon={look.icon}
      tone={look.tone}
      title={t(`phone.punch.${look.code}.title`)}
      message={t(`phone.punch.${look.code}.message`)}
      next={next || undefined}
    >
      {look.retry && onRetry ? (
        <PhoneButton onClick={onRetry}>{t("phone.tryAgain")}</PhoneButton>
      ) : null}
      <PhoneButton variant="outline" onClick={onBack}>
        {t("phone.back")}
      </PhoneButton>
    </ProblemCard>
  );
}

export function CameraProblem({
  status,
  onRetry,
  onTap,
  onBack,
}: {
  status: Exclude<CameraStatus, "opening" | "ready">;
  onRetry: () => void;
  onTap: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  if (status === "needs_tap") {
    return (
      <ProblemCard icon={VideoOff} tone="blue" title={t("phone.camera.tapTitle")}>
        <PhoneButton onClick={onTap}>{t("phone.camera.start")}</PhoneButton>
        <PhoneButton variant="outline" onClick={onBack}>
          {t("phone.back")}
        </PhoneButton>
      </ProblemCard>
    );
  }
  const blocked = status === "blocked";
  const steps = blocked
    ? [
        t("kiosk.punch.CAMERA_BLOCKED.steps.0"),
        t("kiosk.punch.CAMERA_BLOCKED.steps.1"),
        t("kiosk.punch.CAMERA_BLOCKED.steps.2"),
      ]
    : [t("phone.camera.notFound.steps.0"), t("phone.camera.notFound.steps.1")];
  return (
    <ProblemCard
      icon={CameraOff}
      tone={blocked ? "amber" : "grey"}
      title={t(blocked ? "kiosk.punch.CAMERA_BLOCKED.title" : "phone.camera.notFound.title")}
      message={t(blocked ? "kiosk.punch.CAMERA_BLOCKED.message" : "phone.camera.notFound.message")}
      steps={steps}
    >
      <PhoneButton onClick={onRetry}>{t("phone.tryAgain")}</PhoneButton>
      <PhoneButton variant="outline" onClick={onBack}>
        {t("phone.back")}
      </PhoneButton>
    </ProblemCard>
  );
}
