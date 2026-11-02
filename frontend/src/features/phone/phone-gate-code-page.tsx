// The gate-code punch of a worker with an ID card (spec M4b §4.10, design gate P2 screen 5):
//   1. a fresh location reading (the phone must be inside the plant fence);
//   2. the back camera reads the phone code shown at the gate (only texts starting `UPG1.`);
//   3. the front camera: "Look at the camera", `photo_ready_seconds` to get ready, "I'm ready";
//   4. "Checking…" and the result. "Cancel" sends nothing.
// The server checks the code, the place and the photo; the phone only carries them.
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { takeSnapshot } from "@/kiosk/attendance/snapshot";
import {
  PHONE_APP_VERSION,
  type PhoneLocation,
  type PhonePunchAnswer,
  phoneApi,
} from "./phone-api";
import { readPhoneLocation, useCamera, useQrScan } from "./phone-camera-hooks";
import { PhoneEarlyOutStep } from "./phone-early-out-step";
import { useRequestLevelRedirect } from "./phone-face-punch-page";
import { CameraProblem, CodedProblem } from "./phone-problem-views";
import { codeOfFailure } from "./phone-problems";
import { PunchResult } from "./phone-punch-result";
import { PhoneButton, PhoneCard } from "./phone-ui";
import { PHONE_ME_KEY, usePhoneMe } from "./phone-use-phone";

export const GATE_CODE_PREFIX = "UPG1.";

type Stage = "locating" | "scanning" | "photo" | "checking";

export function PhoneGateCodePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const me = usePhoneMe().data;
  const redirect = useRequestLevelRedirect();
  const [stage, setStage] = useState<Stage>("locating");
  const [problem, setProblem] = useState<string | null>(null);
  const [answer, setAnswer] = useState<PhonePunchAnswer | null>(null);
  const [wrongCode, setWrongCode] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const location = useRef<PhoneLocation | null>(null);
  const gateCode = useRef("");
  const photoText = useRef<string | undefined>(undefined);
  const punchId = useRef(crypto.randomUUID());
  const sending = useRef(false);
  const cameraOn =
    (stage === "scanning" || stage === "photo") && problem === null && answer === null;
  const camera = useCamera(stage === "photo" ? "user" : "environment", cameraOn);

  const fail = useCallback(
    (error: unknown) => {
      if (redirect(error)) return;
      setProblem(codeOfFailure(error));
    },
    [redirect],
  );

  const begin = useCallback(async () => {
    setProblem(null);
    setAnswer(null);
    setWrongCode(false);
    setStage("locating");
    photoText.current = undefined;
    punchId.current = crypto.randomUUID();
    sending.current = false;
    try {
      location.current = await readPhoneLocation();
      setStage("scanning");
    } catch (error) {
      fail(error);
    }
  }, [fail]);

  useEffect(() => {
    void begin();
  }, [begin]);

  useQrScan(camera.videoRef, stage === "scanning" && camera.status === "ready", (text) => {
    if (text.startsWith(GATE_CODE_PREFIX)) {
      gateCode.current = text;
      setWrongCode(false);
      setSecondsLeft(me?.settings.photo_ready_seconds ?? 20);
      setStage("photo");
    } else {
      setWrongCode(true);
    }
  });

  const takePhotoAndSend = useCallback(async () => {
    const video = camera.videoRef.current;
    if (sending.current || !video || camera.status !== "ready") return;
    sending.current = true;
    setStage("checking");
    try {
      const photo = await takeSnapshot(video);
      photoText.current = photo; // kept in memory only, in case Agree at the early-OUT alert needs it
      const result = await phoneApi.gateCodePunch({
        client_punch_id: punchId.current,
        gate_code: gateCode.current,
        photo_jpeg: photo,
        location: location.current as PhoneLocation,
        app_version: PHONE_APP_VERSION,
      });
      setAnswer(result);
      void queryClient.invalidateQueries({ queryKey: PHONE_ME_KEY });
    } catch (error) {
      fail(error);
    }
  }, [camera.videoRef, camera.status, fail, queryClient]);

  // Count down while the person gets ready; when time is over the photo is taken anyway.
  useEffect(() => {
    if (stage !== "photo" || camera.status !== "ready") return;
    if (secondsLeft <= 0) {
      void takePhotoAndSend();
      return;
    }
    const timer = setTimeout(() => setSecondsLeft((current) => current - 1), 1000);
    return () => clearTimeout(timer);
  }, [stage, camera.status, secondsLeft, takePhotoAndSend]);

  const back = () => navigate("/phone", { replace: true });

  if (answer?.decision === "needs_confirmation" && answer.early_out) {
    return (
      <PhoneEarlyOutStep
        prompt={answer.early_out}
        photo={photoText.current}
        onAnswer={(confirmed) => {
          setAnswer(confirmed);
          void queryClient.invalidateQueries({ queryKey: PHONE_ME_KEY });
        }}
        onFail={(error) => {
          setAnswer(null);
          fail(error);
        }}
        onCancel={back}
      />
    );
  }
  if (answer) {
    return (
      <PunchResult
        answer={answer}
        plantName={me?.employee.plant.name ?? ""}
        onBack={back}
        onRetry={begin}
      />
    );
  }
  if (problem !== null) return <CodedProblem code={problem} onRetry={begin} onBack={back} />;
  if (stage === "locating") {
    return (
      <PhoneCard role="status" className="flex items-center gap-3 text-xl font-bold">
        <Loader2 className="size-7 animate-spin" aria-hidden />
        {t("phone.punch.locating")}
      </PhoneCard>
    );
  }
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
        onBack={back}
      />
    );
  }
  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-xl border-2 bg-[#0e1726]">
        <video
          ref={camera.videoRef}
          aria-label={t("kiosk.attendance.cameraLabel")}
          className={`aspect-square w-full object-cover ${stage === "photo" ? "-scale-x-100" : ""}`}
          muted
          playsInline
        />
        <p
          role="status"
          aria-live="polite"
          className="bg-signal px-4 py-4 text-center text-xl font-bold text-foreground"
        >
          {stage === "scanning"
            ? t("phone.gateCode.scan")
            : stage === "photo"
              ? t("phone.gateCode.lookAtCamera")
              : t("phone.checking")}
        </p>
      </div>
      {stage === "scanning" && wrongCode ? (
        <p
          role="alert"
          className="flex items-center gap-2 rounded-lg bg-warning-soft p-4 text-lg font-bold text-warning"
        >
          <TriangleAlert aria-hidden />
          {t("phone.gateCode.notGateCode")}
        </p>
      ) : null}
      {stage === "photo" ? (
        <>
          <p className="text-center text-xl font-bold">
            {t("kiosk.attendance.photoIn", { count: secondsLeft })}
          </p>
          <PhoneButton onClick={() => void takePhotoAndSend()}>
            {t("kiosk.attendance.imReady")}
          </PhoneButton>
        </>
      ) : null}
      {stage !== "checking" ? (
        <PhoneButton variant="outline" onClick={back}>
          {t("phone.cancel")}
        </PhoneButton>
      ) : null}
    </div>
  );
}
