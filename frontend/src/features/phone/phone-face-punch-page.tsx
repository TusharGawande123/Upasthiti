// The phone face punch (spec M4b §4.9, design gate P2 screen 4): a fresh location reading first
// (rule 12: the server checks it against the plant fence), then the front camera with the same
// guidance and server-chosen head turn as the gate, then "Checking…" and the result. The phone
// never decides: it sends location and pictures and shows the server's answer.
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { ApiError } from "@/lib/api-client";
import {
  PHONE_APP_VERSION,
  type PhoneLocation,
  type PhonePunchAnswer,
  phoneApi,
} from "./phone-api";
import { readPhoneLocation, useCamera } from "./phone-camera-hooks";
import { PhoneEarlyOutStep } from "./phone-early-out-step";
import { FaceCameraView } from "./phone-face-camera-view";
import { CameraProblem, CodedProblem } from "./phone-problem-views";
import { codeOfFailure } from "./phone-problems";
import { PunchResult } from "./phone-punch-result";
import { PhoneButton, PhoneCard } from "./phone-ui";
import { useFaceRun } from "./phone-use-face-run";
import { PHONE_ME_KEY, usePhoneMe } from "./phone-use-phone";

type Stage = "locating" | "camera" | "done";

/** Sends the person to the right page for a request-level answer that is not a punch result. */
export function useRequestLevelRedirect() {
  const navigate = useNavigate();
  return useCallback(
    (error: unknown): boolean => {
      if (!(error instanceof ApiError)) return false;
      if (error.code === "PHONE_NOTICE_REQUIRED") {
        navigate("/phone/notice", { replace: true });
        return true;
      }
      if (error.code === "PHONE_NOT_SIGNED_IN" || error.code === "PHONE_PUNCH_OFF") {
        navigate("/phone/login", { replace: true, state: { notice: error.code } });
        return true;
      }
      return false;
    },
    [navigate],
  );
}

export function PhoneFacePunchPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const me = usePhoneMe().data;
  const redirect = useRequestLevelRedirect();
  const [stage, setStage] = useState<Stage>("locating");
  const [problem, setProblem] = useState<string | null>(null);
  const [answer, setAnswer] = useState<PhonePunchAnswer | null>(null);
  const location = useRef<PhoneLocation | null>(null);
  const punchId = useRef(crypto.randomUUID());
  const camera = useCamera("user", stage === "camera" && problem === null && answer === null);

  const fail = useCallback(
    (error: unknown) => {
      if (redirect(error)) return;
      setProblem(codeOfFailure(error));
    },
    [redirect],
  );

  const locate = useCallback(async () => {
    setProblem(null);
    setAnswer(null);
    setStage("locating");
    punchId.current = crypto.randomUUID();
    try {
      location.current = await readPhoneLocation();
      setStage("camera");
    } catch (error) {
      fail(error);
    }
  }, [fail]);

  useEffect(() => {
    void locate();
  }, [locate]);

  const run = useFaceRun<PhonePunchAnswer>({
    videoRef: camera.videoRef,
    cameraReady: camera.status === "ready",
    requestChallenge: phoneApi.punchChallenge,
    send: (challenge, frames) =>
      phoneApi.facePunch({
        client_punch_id: punchId.current,
        challenge_nonce: challenge.challenge_nonce,
        frames,
        location: location.current as PhoneLocation,
        app_version: PHONE_APP_VERSION,
      }),
    onDone: (result) => {
      setAnswer(result);
      void queryClient.invalidateQueries({ queryKey: PHONE_ME_KEY });
    },
    onFail: fail,
  });

  // The punch starts by itself as soon as the camera shows a picture.
  const startRun = run.start;
  useEffect(() => {
    if (stage === "camera" && camera.status === "ready" && problem === null && answer === null) {
      startRun();
    }
  }, [stage, camera.status, problem, answer, startRun]);

  const back = () => navigate("/phone", { replace: true });

  if (answer?.decision === "needs_confirmation" && answer.early_out) {
    return (
      <PhoneEarlyOutStep
        prompt={answer.early_out}
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
        onRetry={locate}
      />
    );
  }
  if (problem !== null) return <CodedProblem code={problem} onRetry={locate} onBack={back} />;
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
      <FaceCameraView screen={run.screen} videoRef={camera.videoRef} />
      {run.screen.name === "idle" ? (
        <p role="status" className="text-center text-lg text-muted-foreground">
          {t("phone.camera.opening")}
        </p>
      ) : null}
      {run.screen.name !== "checking" ? (
        <PhoneButton variant="outline" onClick={back}>
          {t("phone.cancel")}
        </PhoneButton>
      ) : null}
    </div>
  );
}
