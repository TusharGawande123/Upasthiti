// The steps of the enrolment wizard as plain data (spec M3 §4.9, decision 0018), kept apart from
// the screen so the rules are easy to read and to test: camera check -> 5 shots -> saving ->
// done, or the duplicate warning (F-39). Closing the wizard cancels the session on the server.
import { type DuplicateMatch, ENROLMENT_POSES, type Pose } from "./use-face";

export type DotState = "pending" | "current" | "checking" | "ok" | "failed";

export type WizardState =
  | { step: "camera"; notice: "restarted" | null }
  | {
      step: "shots";
      sessionId: string;
      poseIndex: number;
      dots: DotState[];
      // The ENROL_* code of the last refused shot, shown with "Retake".
      failure: string | null;
      sending: boolean;
    }
  // overrideReason: the reason typed under the duplicate warning ("Enrol anyway").
  | { step: "saving"; sessionId: string; overrideReason: string | null }
  | { step: "duplicate"; sessionId: string; matches: DuplicateMatch[] }
  | { step: "done"; shotCount: number };

export type WizardEvent =
  | { type: "started"; sessionId: string }
  | { type: "shot_sent" }
  | { type: "shot_answer"; accepted: boolean; reasonCode: string | null; nextPose: Pose | null }
  | { type: "shot_failed"; reasonCode: string }
  | { type: "retake" }
  | { type: "duplicate"; matches: DuplicateMatch[] }
  | { type: "override"; reason: string }
  | { type: "finished"; shotCount: number }
  // The server closed the session (idle clean-up, or another admin started one): go back to the
  // camera check quietly. There is no "took too long" screen (decision 0018).
  | { type: "session_lost" };

export const INITIAL_STATE: WizardState = { step: "camera", notice: null };

function freshDots(): DotState[] {
  return ENROLMENT_POSES.map((_, index) => (index === 0 ? "current" : "pending"));
}

export function wizardReducer(state: WizardState, event: WizardEvent): WizardState {
  switch (event.type) {
    case "started":
      return {
        step: "shots",
        sessionId: event.sessionId,
        poseIndex: 0,
        dots: freshDots(),
        failure: null,
        sending: false,
      };
    case "session_lost":
      return { step: "camera", notice: "restarted" };
    case "finished":
      return { step: "done", shotCount: event.shotCount };
    default:
      break;
  }

  if (state.step === "shots") return shotsReducer(state, event);
  if (state.step === "saving" && event.type === "duplicate") {
    return { step: "duplicate", sessionId: state.sessionId, matches: event.matches };
  }
  if (state.step === "duplicate" && event.type === "override") {
    return { step: "saving", sessionId: state.sessionId, overrideReason: event.reason };
  }
  return state;
}

type ShotsState = Extract<WizardState, { step: "shots" }>;

function withDot(dots: DotState[], index: number, value: DotState): DotState[] {
  return dots.map((dot, position) => (position === index ? value : dot));
}

function shotsReducer(state: ShotsState, event: WizardEvent): WizardState {
  switch (event.type) {
    case "shot_sent":
      return {
        ...state,
        sending: true,
        failure: null,
        dots: withDot(state.dots, state.poseIndex, "checking"),
      };
    case "shot_failed":
      return {
        ...state,
        sending: false,
        failure: event.reasonCode,
        dots: withDot(state.dots, state.poseIndex, "failed"),
      };
    case "shot_answer": {
      if (!event.accepted) {
        return {
          ...state,
          sending: false,
          failure: event.reasonCode ?? "ENROL_IMAGE_INVALID",
          dots: withDot(state.dots, state.poseIndex, "failed"),
        };
      }
      const dots = withDot(state.dots, state.poseIndex, "ok");
      // The server says which pose is still missing; null means all five are accepted.
      if (event.nextPose === null) {
        return { step: "saving", sessionId: state.sessionId, overrideReason: null };
      }
      const next = ENROLMENT_POSES.indexOf(event.nextPose);
      return {
        ...state,
        sending: false,
        failure: null,
        poseIndex: next,
        dots: withDot(dots, next, "current"),
      };
    }
    case "retake":
      return {
        ...state,
        failure: null,
        dots: withDot(state.dots, state.poseIndex, "current"),
      };
    default:
      return state;
  }
}

/** Errors that mean "this session is gone, start again from the camera check". */
export const SESSION_LOST_CODES = new Set([
  "ENROLMENT_SESSION_EXPIRED",
  "ENROLMENT_SESSION_CLOSED",
  "ENROLMENT_SESSION_NOT_FOUND",
]);
