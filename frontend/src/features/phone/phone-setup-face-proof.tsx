// "Check my face" (spec M4b §4.5): type the employee code, then the front camera runs the same
// guidance and head turn as the gate's face punch. The server answers with a proof token for
// every well-formed code, so nothing here tells whether the code exists.
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { type ProofAnswer, phoneApi } from "./phone-api";
import { useCamera } from "./phone-camera-hooks";
import { FaceCameraView } from "./phone-face-camera-view";
import { CameraProblem, CodedProblem } from "./phone-problem-views";
import { codeOfFailure } from "./phone-problems";
import { PhoneButton, PhoneCard, PhoneTitle } from "./phone-ui";
import { useFaceRun } from "./phone-use-face-run";

export function SetupFaceProof({
  onProven,
  onBack,
}: {
  onProven: (answer: ProofAnswer) => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const [code, setCode] = useState("");
  const [started, setStarted] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const camera = useCamera("user", started && problem === null);
  // The proof id comes with the challenge; the pictures go with it.
  const proofId = useRef("");

  const run = useFaceRun<ProofAnswer>({
    videoRef: camera.videoRef,
    cameraReady: camera.status === "ready",
    requestChallenge: async () => {
      const challenge = await phoneApi.faceProofChallenge(code.trim());
      proofId.current = challenge.proof_id;
      return challenge;
    },
    send: (challenge, frames) =>
      phoneApi.faceProof({
        proof_id: proofId.current,
        challenge_nonce: challenge.challenge_nonce,
        frames,
      }),
    onDone: onProven,
    onFail: (error) => {
      setProblem(codeOfFailure(error));
    },
  });

  // The check starts by itself as soon as the camera shows a picture (like the punch).
  const startRun = run.start;
  useEffect(() => {
    if (started && camera.status === "ready" && problem === null && run.screen.name === "idle") {
      startRun();
    }
  }, [started, camera.status, problem, run.screen.name, startRun]);

  const reset = () => {
    run.cancel();
    setProblem(null);
    setStarted(false);
  };

  if (problem !== null) {
    return (
      <CodedProblem
        code={problem}
        onRetry={() => {
          setProblem(null);
          run.start();
        }}
        onBack={() => {
          reset();
          onBack();
        }}
      />
    );
  }

  if (!started) {
    return (
      <>
        <PhoneTitle hint={t("phone.setup.face.hint")}>{t("phone.setup.face.title")}</PhoneTitle>
        <PhoneCard>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (code.trim()) setStarted(true);
            }}
          >
            <Field id="proof-code" label={t("phone.login.code")}>
              <Input
                id="proof-code"
                className="h-15 font-mono text-xl uppercase"
                autoCapitalize="characters"
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
              />
            </Field>
            <PhoneButton type="submit" disabled={!code.trim()}>
              {t("phone.setup.startCamera")}
            </PhoneButton>
            <PhoneButton variant="outline" onClick={onBack}>
              {t("phone.back")}
            </PhoneButton>
          </form>
        </PhoneCard>
      </>
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
        onBack={reset}
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
      <PhoneButton variant="outline" onClick={reset}>
        {t("phone.cancel")}
      </PhoneButton>
    </div>
  );
}
