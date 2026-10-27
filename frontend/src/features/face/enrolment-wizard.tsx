// The face enrolment wizard (spec M3 §4.9, decisions 0016 and 0018). Full screen, on a laptop
// webcam or a phone. Step 1: camera and light check. Step 2: five guided shots, each sent at once
// and checked by the server (✓ or a plain reason with "Retake"). Step 3: saving, or the duplicate
// warning (F-39). There is no timer: closing the wizard cancels the session, and the server
// deletes a forgotten one after two idle hours.
//
// MediaPipe only gives live hints and takes the shot by itself when the pose is held for one
// second. Without it (old browser) the "Take shot" button still works: the server decides.
import {
  Camera,
  Check,
  CircleAlert,
  CircleCheck,
  FlipHorizontal2,
  Loader2,
  Lock,
  Play,
  RotateCcw,
  ScanFace,
  Sun,
  TriangleAlert,
  User,
  X,
} from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { describeError } from "@/features/auth/error-message";
import { ApiError } from "@/lib/api-client";
import type { FaceGuide } from "@/lib/face-guide/landmarker";
import { type Hint, hintFor } from "@/lib/face-guide/pose-estimate";
import { cn } from "@/lib/utils";
import {
  type DotState,
  INITIAL_STATE,
  SESSION_LOST_CODES,
  type WizardState,
  wizardReducer,
} from "./enrolment-state";
import {
  type CameraChoice,
  FaceCameraError,
  listCameras,
  startFaceCamera,
  stopFaceCamera,
  takeShot,
} from "./face-camera";
import { PosePicture } from "./pose-picture";
import {
  cancelEnrolment,
  type DuplicateMatch,
  ENROLMENT_POSES,
  finishEnrolment,
  sendShot,
  startEnrolment,
  useRefreshAfterEnrolment,
} from "./use-face";

const HOLD_MS = 1000; // the pose must be held this long before the automatic shot
const GUIDE_EVERY_MS = 150;
const MIN_OVERRIDE_REASON = 10;

type WizardEmployee = { id: string; full_name: string; employee_code: string; plant_code: string };

// --- Small pieces ---------------------------------------------------------------------------

function ShotDots({ dots }: { dots: DotState[] }) {
  const { t } = useTranslation();
  const done = dots.filter((dot) => dot === "ok").length;
  return (
    <div>
      <ol
        className="flex justify-between gap-1.5"
        aria-label={t("face.wizard.progress", { done, total: dots.length })}
      >
        {dots.map((dot, index) => (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: one dot per fixed pose
            key={index}
            aria-label={t(`face.wizard.dot.${dot}`, { number: index + 1 })}
            className={cn(
              "grid size-10 place-items-center rounded-full border-2 text-sm font-bold",
              dot === "ok" && "border-success bg-success text-white",
              dot === "failed" && "border-destructive bg-destructive text-white",
              dot === "current" &&
                "border-primary bg-primary text-primary-foreground ring-4 ring-primary-soft",
              dot === "checking" && "border-primary bg-primary-soft text-primary",
              dot === "pending" && "border-dashed border-border-strong text-muted-foreground",
            )}
          >
            {dot === "ok" ? (
              <Check className="size-4" aria-hidden />
            ) : dot === "failed" ? (
              <X className="size-4" aria-hidden />
            ) : dot === "checking" ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              index + 1
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function CameraView({
  videoRef,
  tone,
  strip,
}: {
  videoRef: (element: HTMLVideoElement | null) => void;
  tone: "neutral" | "ok" | "bad" | "hold";
  strip: { tone: "info" | "ok" | "warn" | "bad"; text: string } | null;
}) {
  const { t } = useTranslation();
  return (
    <div className="relative mx-auto aspect-[4/3] w-full max-w-xl overflow-hidden rounded-2xl border-4 border-foreground/80 bg-foreground">
      {/* Mirrored preview: people expect to see themselves as in a mirror. The shot is not. */}
      <video ref={videoRef} className="size-full -scale-x-100 object-cover" muted playsInline />
      <span className="absolute top-3 left-3 inline-flex items-center gap-1.5 rounded-md bg-black/60 px-2 py-1 text-xs font-semibold text-white">
        <FlipHorizontal2 className="size-3.5" aria-hidden />
        {t("face.wizard.mirrored")}
      </span>
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute top-1/2 left-1/2 h-[72%] w-[42%] -translate-x-1/2 -translate-y-1/2 rounded-[50%] border-4 border-dashed",
          tone === "neutral" && "border-white/90",
          tone === "hold" && "border-solid border-primary-soft",
          tone === "ok" && "border-solid border-success",
          tone === "bad" && "border-solid border-destructive",
        )}
      />
      {strip ? (
        <p
          aria-live="polite"
          className={cn(
            "absolute inset-x-0 bottom-0 px-4 py-2.5 text-sm font-bold sm:text-base",
            strip.tone === "info" && "bg-[#f5b700] text-foreground",
            strip.tone === "ok" && "bg-success text-white",
            strip.tone === "warn" && "bg-[#f5b700] text-foreground",
            strip.tone === "bad" && "bg-destructive text-white",
          )}
        >
          {strip.text}
        </p>
      ) : null}
    </div>
  );
}

function DuplicateWarning({
  matches,
  onConfirm,
  onCancel,
}: {
  matches: DuplicateMatch[];
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const valid = reason.trim().length >= MIN_OVERRIDE_REASON;
  const first = matches[0];
  return (
    <section className="mx-auto w-full max-w-lg space-y-4 rounded-xl border-2 border-warning bg-card p-5">
      <h2 className="flex items-center gap-2 text-lg font-bold">
        <TriangleAlert className="size-5 text-warning" aria-hidden />
        {first
          ? t("face.wizard.duplicate.title", {
              code: first.employee_code,
              name: first.name,
              plant: first.plant_code,
            })
          : t("errors.FACE_DUPLICATE_FOUND")}
      </h2>
      {matches.length > 1 ? (
        <ul className="list-disc pl-5 text-sm">
          {matches.slice(1).map((match) => (
            <li key={match.employee_id}>
              {match.employee_code} · {match.name} · {match.plant_code}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="text-sm text-muted-foreground">{t("face.wizard.duplicate.text")}</p>
      <Field
        id="duplicate-reason"
        label={t("face.wizard.duplicate.reason")}
        hint={t("face.wizard.duplicate.reasonHint")}
      >
        <Textarea
          id="duplicate-reason"
          value={reason}
          maxLength={300}
          onChange={(event) => setReason(event.target.value)}
        />
      </Field>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" size="lg" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button
          variant="danger"
          size="lg"
          disabled={!valid}
          onClick={() => onConfirm(reason.trim())}
        >
          {t("face.wizard.duplicate.confirm")}
        </Button>
      </div>
    </section>
  );
}

// --- The wizard -----------------------------------------------------------------------------

export function EnrolmentWizard({
  employee,
  onClose,
}: {
  employee: WizardEmployee;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const refresh = useRefreshAfterEnrolment();
  const [state, dispatch] = useReducer(wizardReducer, INITIAL_STATE);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // The video sits in a portal, so it appears after the first render: keep it in state too, so
  // the camera starts as soon as the element exists.
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);
  const attachVideo = useCallback((element: HTMLVideoElement | null) => {
    videoRef.current = element;
    setVideoElement(element);
  }, []);
  const streamRef = useRef<MediaStream | null>(null);
  const guideRef = useRef<FaceGuide | null>(null);
  // The session to cancel when the wizard closes before it is finished.
  const openSessionRef = useRef<string | null>(null);
  const straightNoseRef = useRef<number | null>(null);
  const holdSinceRef = useRef<number | null>(null);
  const [cameras, setCameras] = useState<CameraChoice[]>([]);
  const [cameraId, setCameraId] = useState<string | null>(null);
  const [cameraProblem, setCameraProblem] = useState<string | null>(null);
  const [hint, setHint] = useState<Hint | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [starting, setStarting] = useState(false);

  // Camera on while the wizard is open; always off when it closes.
  useEffect(() => {
    const video = videoElement;
    if (!video) return;
    let cancelled = false;
    setCameraProblem(null);
    startFaceCamera(video, cameraId)
      .then(async (stream) => {
        if (cancelled) return stopFaceCamera(stream);
        streamRef.current = stream;
        setCameras(await listCameras());
      })
      .catch((problem) =>
        setCameraProblem(problem instanceof FaceCameraError ? problem.problem : "CAMERA_NOT_FOUND"),
      );
    return () => {
      cancelled = true;
      stopFaceCamera(streamRef.current);
      streamRef.current = null;
    };
  }, [videoElement, cameraId]);

  // The pose guide loads in the background; the wizard works without it.
  useEffect(() => {
    let closed = false;
    import("@/lib/face-guide/landmarker")
      .then(({ loadFaceGuide }) => loadFaceGuide())
      .then((guide) => {
        if (closed) guide?.close();
        else guideRef.current = guide;
      });
    return () => {
      closed = true;
      guideRef.current?.close();
      guideRef.current = null;
    };
  }, []);

  // A wizard that closes before the end cancels its session: the server deletes its shots.
  useEffect(
    () => () => {
      const sessionId = openSessionRef.current;
      if (sessionId) cancelEnrolment(sessionId).catch(() => undefined);
    },
    [],
  );

  const close = () => {
    refresh();
    onClose();
  };

  const loseSession = useCallback(() => {
    openSessionRef.current = null;
    straightNoseRef.current = null;
    dispatch({ type: "session_lost" });
  }, []);

  const begin = async () => {
    setStarting(true);
    setError(null);
    try {
      const session = await startEnrolment(employee.id);
      openSessionRef.current = session.session_id;
      straightNoseRef.current = null;
      dispatch({ type: "started", sessionId: session.session_id });
    } catch (problem) {
      setError(problem);
    } finally {
      setStarting(false);
    }
  };

  const shotsState = state.step === "shots" ? state : null;
  const pose = shotsState ? ENROLMENT_POSES[shotsState.poseIndex] : null;

  const shoot = useCallback(async () => {
    const video = videoRef.current;
    if (!shotsState || !pose || shotsState.sending || !video) return;
    holdSinceRef.current = null;
    setError(null);
    dispatch({ type: "shot_sent" });
    // The nose height of the straight shot is the baseline for "chin up / down" hints.
    const noseNow = guideRef.current?.read(video, performance.now())[0]?.noseHeight ?? null;
    try {
      const image = await takeShot(video);
      const answer = await sendShot(shotsState.sessionId, pose, image);
      if (answer.accepted && pose === "straight") straightNoseRef.current = noseNow;
      dispatch({
        type: "shot_answer",
        accepted: answer.accepted,
        reasonCode: answer.reason_code,
        nextPose: answer.next_pose,
      });
    } catch (problem) {
      if (problem instanceof ApiError && SESSION_LOST_CODES.has(problem.code)) return loseSession();
      const code = problem instanceof ApiError ? problem.code : "ENROL_IMAGE_INVALID";
      if (code.startsWith("ENROL_")) dispatch({ type: "shot_failed", reasonCode: code });
      else {
        setError(problem);
        dispatch({ type: "shot_failed", reasonCode: "ENROL_IMAGE_INVALID" });
      }
    }
  }, [shotsState, pose, loseSession]);

  // Live hints, and the automatic shot after the pose is held for one second.
  useEffect(() => {
    if (!shotsState || shotsState.sending || shotsState.failure || !pose) {
      setHint(null);
      return;
    }
    const timer = window.setInterval(() => {
      const video = videoRef.current;
      const guide = guideRef.current;
      if (!video || !guide || video.readyState < 2) return;
      const next = hintFor(pose, guide.read(video, performance.now()), straightNoseRef.current);
      setHint(next);
      if (next !== "hold") {
        holdSinceRef.current = null;
        return;
      }
      const now = performance.now();
      holdSinceRef.current ??= now;
      if (now - holdSinceRef.current >= HOLD_MS) void shoot();
    }, GUIDE_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [shotsState, pose, shoot]);

  // Saving: average the five shots into the template on the server.
  const finish = useCallback(
    async (sessionId: string, overrideReason?: string) => {
      setError(null);
      try {
        const result = await finishEnrolment(sessionId, overrideReason);
        openSessionRef.current = null;
        dispatch({ type: "finished", shotCount: result.template.shot_count });
      } catch (problem) {
        if (problem instanceof ApiError && problem.code === "FACE_DUPLICATE_FOUND") {
          const matches = (problem.details.matches as DuplicateMatch[] | undefined) ?? [];
          dispatch({ type: "duplicate", matches });
        } else if (problem instanceof ApiError && SESSION_LOST_CODES.has(problem.code)) {
          loseSession();
        } else {
          setError(problem);
        }
      }
    },
    [loseSession],
  );

  // Entering "saving" (after the fifth shot, or "Enrol anyway") asks the server once.
  const saving = state.step === "saving" ? state : null;
  useEffect(() => {
    if (saving) void finish(saving.sessionId, saving.overrideReason ?? undefined);
  }, [saving, finish]);

  return (
    <DialogPrimitive.Root open onOpenChange={(open) => !open && close()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-background"
        >
          <header className="flex items-center gap-3 border-b bg-card px-4 py-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">
              <ScanFace aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="text-lg font-bold">
                {t("face.wizard.title")}
              </DialogPrimitive.Title>
              <p className="truncate text-[13px] text-muted-foreground">
                {employee.full_name} · <span className="code">{employee.employee_code}</span> ·{" "}
                {employee.plant_code}
              </p>
            </div>
            <Button
              variant="outline"
              className="size-11 px-0 sm:w-auto sm:px-4"
              aria-label={t("face.wizard.cancel")}
              onClick={close}
            >
              <X aria-hidden />
              <span className="hidden sm:inline">{t("common.cancel")}</span>
            </Button>
          </header>

          <div className="mx-auto grid w-full max-w-6xl flex-1 gap-5 p-4 lg:grid-cols-[1.3fr_1fr] lg:items-start">
            {/* The camera stays mounted in every step, so it does not restart between shots. */}
            <div
              className={cn(state.step === "done" || state.step === "duplicate" ? "hidden" : "")}
            >
              {cameraProblem ? (
                <Alert tone="warning">
                  <CircleAlert aria-hidden />
                  <span>{t(`face.wizard.camera.${cameraProblem}`)}</span>
                </Alert>
              ) : null}
              <CameraView videoRef={attachVideo} {...cameraLook(state, hint, t)} />
            </div>

            <div className="space-y-4">
              {error ? (
                <Alert tone="danger">
                  <span>{describeError(error, t)}</span>
                </Alert>
              ) : null}
              <StepPanel
                state={state}
                cameras={cameras}
                cameraId={cameraId}
                onCamera={setCameraId}
                cameraReady={!cameraProblem}
                starting={starting}
                onStart={begin}
                onShoot={shoot}
                onRetake={() => dispatch({ type: "retake" })}
                onOverride={(reason) => dispatch({ type: "override", reason })}
                onClose={close}
                employeeName={employee.full_name}
              />
              {state.step !== "done" ? (
                <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
                  <Lock className="size-3.5 shrink-0" aria-hidden />
                  {t("face.wizard.privacyNote")}
                </p>
              ) : null}
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

type Translate = ReturnType<typeof useTranslation>["t"];

/** The oval colour and the strip text under the camera for the current step. */
function cameraLook(state: WizardState, hint: Hint | null, t: Translate) {
  if (state.step === "camera") {
    return {
      tone: "neutral" as const,
      strip: { tone: "info" as const, text: t("face.wizard.lightTip") },
    };
  }
  if (state.step !== "shots") return { tone: "neutral" as const, strip: null };
  if (state.sending) {
    return {
      tone: "hold" as const,
      strip: { tone: "info" as const, text: t("face.wizard.checking") },
    };
  }
  if (state.failure) {
    return {
      tone: "bad" as const,
      strip: { tone: "bad" as const, text: t("face.wizard.notAccepted") },
    };
  }
  if (hint === "hold") {
    return { tone: "hold" as const, strip: { tone: "ok" as const, text: t("face.hint.hold") } };
  }
  if (hint) {
    return {
      tone: "neutral" as const,
      strip: { tone: "warn" as const, text: t(`face.hint.${hint}`) },
    };
  }
  return { tone: "neutral" as const, strip: null };
}

type StepPanelProps = {
  state: WizardState;
  cameras: CameraChoice[];
  cameraId: string | null;
  onCamera: (id: string) => void;
  cameraReady: boolean;
  starting: boolean;
  onStart: () => void;
  onShoot: () => void;
  onRetake: () => void;
  onOverride: (reason: string) => void;
  onClose: () => void;
  employeeName: string;
};

function StepPanel(props: StepPanelProps) {
  const { t } = useTranslation();
  const { state } = props;

  if (state.step === "camera") {
    return (
      <section className="space-y-4 rounded-xl border bg-card p-5">
        <p className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
          {t("face.wizard.cameraStep")}
        </p>
        <h2 className="text-xl font-bold">{t("face.wizard.cameraTitle")}</h2>
        {state.notice === "restarted" ? (
          <Alert tone="info">
            <span>{t("face.wizard.restarted")}</span>
          </Alert>
        ) : null}
        {props.cameras.length > 1 ? (
          <Field id="face-camera" label={t("face.wizard.cameraChoice")}>
            <Select
              id="face-camera"
              value={props.cameraId ?? props.cameras[0]?.deviceId ?? ""}
              onChange={(event) => props.onCamera(event.target.value)}
            >
              {props.cameras.map((camera) => (
                <option key={camera.deviceId} value={camera.deviceId}>
                  {camera.label}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <ul className="space-y-2 text-sm">
          <li className="flex items-center gap-3">
            <span className="grid size-8 place-items-center rounded-lg bg-warning-soft text-warning">
              <Sun className="size-4" aria-hidden />
            </span>
            {t("face.wizard.tipLight")}
          </li>
          <li className="flex items-center gap-3">
            <span className="grid size-8 place-items-center rounded-lg bg-warning-soft text-warning">
              <User className="size-4" aria-hidden />
            </span>
            {t("face.wizard.tipAlone")}
          </li>
        </ul>
        <Button
          size="lg"
          className="h-14 w-full text-base"
          disabled={!props.cameraReady || props.starting}
          onClick={props.onStart}
        >
          {props.starting ? <Loader2 className="animate-spin" /> : <Play aria-hidden />}
          {t("face.wizard.start")}
        </Button>
      </section>
    );
  }

  if (state.step === "shots") {
    const pose = ENROLMENT_POSES[state.poseIndex] ?? "straight";
    return (
      <section className="space-y-4 rounded-xl border bg-card p-5" aria-live="polite">
        <p className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
          {t("face.wizard.shotOf", { number: state.poseIndex + 1, total: ENROLMENT_POSES.length })}
        </p>
        <div className="flex items-center gap-4">
          <PosePicture pose={pose} className="size-20 shrink-0 rounded-xl border bg-primary-soft" />
          <p className="text-lg leading-snug font-bold sm:text-2xl">{t(`face.pose.${pose}`)}</p>
        </div>
        {state.failure ? (
          <Alert tone="danger">
            <CircleAlert aria-hidden />
            <span>
              <b>{t(`errors.${state.failure}`, { pose: t(`face.pose.${pose}`) })}</b>{" "}
              {t("face.wizard.othersKept", { number: state.poseIndex + 1 })}
            </span>
          </Alert>
        ) : null}
        <ShotDots dots={state.dots} />
        {state.failure ? (
          <Button size="lg" className="h-14 w-full text-base" onClick={props.onRetake}>
            <RotateCcw aria-hidden />
            {t("face.wizard.retake")}
          </Button>
        ) : (
          <Button
            size="lg"
            className="h-14 w-full text-base"
            disabled={state.sending}
            onClick={props.onShoot}
          >
            {state.sending ? <Loader2 className="animate-spin" /> : <Camera aria-hidden />}
            {state.sending ? t("face.wizard.checking") : t("face.wizard.takeShot")}
          </Button>
        )}
      </section>
    );
  }

  if (state.step === "saving") {
    return (
      <section className="space-y-3 rounded-xl border bg-card p-6 text-center" aria-busy="true">
        <Loader2 className="mx-auto size-10 animate-spin text-primary" aria-hidden />
        <h2 className="text-xl font-bold">{t("face.wizard.saving")}</h2>
        <p className="text-sm text-muted-foreground">{t("face.wizard.savingText")}</p>
      </section>
    );
  }

  if (state.step === "duplicate") {
    return (
      <DuplicateWarning
        matches={state.matches}
        onConfirm={props.onOverride}
        onCancel={props.onClose}
      />
    );
  }

  return (
    <section className="mx-auto max-w-lg space-y-3 rounded-xl border bg-card p-6 text-center">
      <CircleCheck className="mx-auto size-12 text-success" aria-hidden />
      <h2 className="text-xl font-bold">
        {t("face.wizard.doneTitle", { name: props.employeeName })}
      </h2>
      <p className="text-sm text-muted-foreground">
        {t("face.wizard.doneText", { count: state.shotCount })}
      </p>
      <Button size="lg" className="mt-2" onClick={props.onClose}>
        <Check aria-hidden />
        {t("face.wizard.done")}
      </Button>
    </section>
  );
}
