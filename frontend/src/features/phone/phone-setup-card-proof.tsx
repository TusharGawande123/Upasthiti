// "Scan my ID card" (spec M4b §4.5): the phone must be inside the plant fence, so the screen says
// so BEFORE the camera opens, reads the location once, then the back camera reads the card's QR
// code. The server decides everything; an expired, revoked or test card gets the same answer as
// a wrong person (PROOF_FAILED).
import { MapPin } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CARD_PREFIX } from "@/kiosk/attendance/qr-reader";
import { type PhoneLocation, type ProofAnswer, phoneApi } from "./phone-api";
import { readPhoneLocation, useCamera, useQrScan } from "./phone-camera-hooks";
import { CameraProblem, CodedProblem } from "./phone-problem-views";
import { codeOfFailure } from "./phone-problems";
import { Notice, PhoneButton, PhoneCard, PhoneTitle } from "./phone-ui";

type Step = "intro" | "locating" | "scanning" | "checking";

export function SetupCardProof({
  onProven,
  onBack,
}: {
  onProven: (answer: ProofAnswer) => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>("intro");
  const [problem, setProblem] = useState<string | null>(null);
  const location = useRef<PhoneLocation | null>(null);
  const camera = useCamera("environment", step === "scanning" || step === "checking");

  const begin = useCallback(async () => {
    setProblem(null);
    setStep("locating");
    try {
      location.current = await readPhoneLocation();
      setStep("scanning");
    } catch (error) {
      setProblem(codeOfFailure(error));
      setStep("intro");
    }
  }, []);

  const onText = useCallback(
    async (text: string) => {
      if (!text.startsWith(CARD_PREFIX) || !location.current) return;
      setStep("checking");
      try {
        onProven(await phoneApi.cardProof({ qr_payload: text, location: location.current }));
      } catch (error) {
        setProblem(codeOfFailure(error));
        setStep("intro");
      }
    },
    [onProven],
  );
  useQrScan(camera.videoRef, camera.status === "ready" && step === "scanning", onText);

  if (problem !== null) {
    return <CodedProblem code={problem} onRetry={begin} onBack={onBack} />;
  }
  if (step === "scanning" || step === "checking") {
    if (
      camera.status === "blocked" ||
      camera.status === "not_found" ||
      camera.status === "needs_tap"
    ) {
      return (
        <CameraProblem
          status={camera.status}
          onRetry={camera.retry}
          onTap={camera.tapToPlay}
          onBack={onBack}
        />
      );
    }
    return (
      <div className="space-y-3">
        <div className="overflow-hidden rounded-xl border-2 bg-[#0e1726]">
          <video
            ref={camera.videoRef}
            aria-label={t("phone.setup.card.cameraLabel")}
            className="aspect-square w-full object-cover"
            muted
            playsInline
          />
          <p
            role="status"
            aria-live="polite"
            className="bg-signal px-4 py-4 text-center text-xl font-bold text-foreground"
          >
            {step === "checking" ? t("phone.checking") : t("phone.setup.card.show")}
          </p>
        </div>
        <PhoneButton variant="outline" onClick={onBack}>
          {t("phone.cancel")}
        </PhoneButton>
      </div>
    );
  }

  return (
    <>
      <PhoneTitle hint={t("phone.setup.card.hint")}>{t("phone.setup.card.title")}</PhoneTitle>
      <PhoneCard className="space-y-4">
        <Notice tone="info" icon={MapPin}>
          <p className="font-bold">{t("phone.setup.cardIntro.title")}</p>
          <p>{t("phone.setup.cardIntro.body")}</p>
        </Notice>
        <PhoneButton busy={step === "locating"} onClick={begin}>
          {step === "locating" ? t("phone.setup.card.locating") : t("phone.setup.startCamera")}
        </PhoneButton>
        <PhoneButton variant="outline" onClick={onBack}>
          {t("phone.back")}
        </PhoneButton>
      </PhoneCard>
    </>
  );
}
