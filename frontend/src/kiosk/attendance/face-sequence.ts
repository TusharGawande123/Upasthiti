// The gate's face punch as small pure steps, so they can be tested without a camera (spec M3
// §4.2, §4.3): first the guidance (is one face inside the oval, close enough, held still?), then
// the head turn the server asked for, frame by frame.
//
// GUIDANCE ONLY: MediaPipe's numbers decide when the device takes its pictures, never whether the
// person is accepted. The server measures the real turn and decides every punch (spec §7).
import { hintFor, type Measure } from "@/lib/face-guide/pose-estimate";
import type { ChallengeName } from "./punch-client";

export type Direction = "left" | "right";

// What each challenge asks for, in order. "left" is the person's OWN left (as on the server).
export const CHALLENGE_STEPS: Record<ChallengeName, Direction[]> = {
  turn_left: ["left"],
  turn_right: ["right"],
  left_then_right: ["left", "right"],
  right_then_left: ["right", "left"],
};

// --- Guidance -------------------------------------------------------------------------------

export const GOOD_FOR_MS = 500; // the face must be good this long before a challenge is asked
export const GUIDE_TIMEOUT_MS = 10_000; // then "We could not see your face clearly"
export const GUIDE_GIVE_UP_MS = 30_000; // no progress at all: back to the idle screen

export type GuideHint = "closer" | "farther" | "one_person" | "centre" | "light";

export type GuideReading = { good: boolean; hint: GuideHint | null };

/**
 * What the oval says for the faces MediaPipe sees. `faces` is null when MediaPipe could not load
 * (old device): then the picture is taken as good at once (timed fallback, spec §4.2).
 */
export function readGuide(faces: Measure[] | null, tooDark: boolean): GuideReading {
  if (faces === null) return { good: true, hint: null };
  const hint = hintFor("straight", faces, null);
  switch (hint) {
    case "hold":
      return { good: true, hint: null };
    case "closer":
      return { good: false, hint: "closer" };
    case "farther":
      return { good: false, hint: "farther" };
    case "two_faces":
      return { good: false, hint: "one_person" };
    case "centre":
      return { good: false, hint: "centre" };
    default:
      // No face yet, or the head is turned: the line at the top already says what to do. In a
      // dark gate the more useful hint is the light.
      return { good: false, hint: tooDark ? "light" : null };
  }
}

/** Tracks how long the face has been good; `ready` after GOOD_FOR_MS in a row. */
export class GuideTracker {
  private goodSince: number | null = null;

  update(now: number, good: boolean): { ready: boolean } {
    if (!good) {
      this.goodSince = null;
      return { ready: false };
    }
    this.goodSince ??= now;
    return { ready: now - this.goodSince >= GOOD_FOR_MS };
  }
}

// --- The head turn --------------------------------------------------------------------------

// MediaPipe's "turn" is the nose's sideways shift in eye distances, not degrees. This is a rough
// conversion (about 0.0175 per degree) that the accuracy runs with real faces in slice D check.
export const TURN_PER_DEGREE = 0.0175;
// The picture is taken when MediaPipe sees the turn this many degrees past the server's minimum
// (spec §4.3), so a small difference between MediaPipe and the server does not cost a retry.
export const TURN_MARGIN_DEGREES = 7;
const STRAIGHT_MAX_TURN = 0.1;
const STRAIGHT_HOLD_MS = 300;
// Timed fallback without MediaPipe: a turn picture every 1.5 s after the first frontal one.
export const TIMED_STEP_MS = 1_500;

export type FrameRole = "frontal" | "turn";

export type CaptureAction = { type: "none" } | { type: "take"; role: FrameRole };

/** What the screen shows right now: an arrow for step `index`, or "look straight again". */
export type CaptureShown =
  | { phase: "turn"; direction: Direction; index: number }
  | { phase: "straight" };

export function turnReached(face: Measure, direction: Direction, minYawDegrees: number): boolean {
  const target = (minYawDegrees + TURN_MARGIN_DEGREES) * TURN_PER_DEGREE;
  // MediaPipe's turn is positive towards the person's own left.
  return (direction === "left" ? face.turn : -face.turn) >= target;
}

/**
 * Walks through the frames of one challenge: frontal at the start, one "turn" frame per step, and
 * frontal again at the end (2 to 4 frames, as the server expects). The caller calls `start()`
 * once and then `update()` several times a second; an action says "take a picture now".
 */
export class CaptureTracker {
  private index = 0;
  private straightSince: number | null = null;
  private finished = false;
  private startedAt = 0;

  /**
   * @param steps the directions of the challenge
   * @param guided true when MediaPipe can see the face; false uses the timed fallback
   */
  constructor(
    private readonly steps: Direction[],
    private readonly minYawDegrees: number,
    private readonly guided: boolean,
  ) {}

  get done(): boolean {
    return this.finished;
  }

  get shown(): CaptureShown {
    const direction = this.steps[this.index];
    return direction ? { phase: "turn", direction, index: this.index } : { phase: "straight" };
  }

  start(now: number): CaptureAction {
    this.startedAt = now;
    return { type: "take", role: "frontal" };
  }

  update(now: number, faces: Measure[] | null): CaptureAction {
    if (this.finished) return { type: "none" };
    return this.guided ? this.updateGuided(now, faces) : this.updateTimed(now);
  }

  private updateTimed(now: number): CaptureAction {
    const due = this.startedAt + (this.index + 1) * TIMED_STEP_MS;
    if (now < due) return { type: "none" };
    if (this.index < this.steps.length) {
      this.index += 1;
      return { type: "take", role: "turn" };
    }
    this.finished = true;
    return { type: "take", role: "frontal" };
  }

  private updateGuided(now: number, faces: Measure[] | null): CaptureAction {
    const face = faces?.length === 1 ? faces[0] : undefined;
    if (!face) {
      this.straightSince = null;
      return { type: "none" };
    }
    const direction = this.steps[this.index];
    if (direction) {
      if (!turnReached(face, direction, this.minYawDegrees)) return { type: "none" };
      this.index += 1;
      return { type: "take", role: "turn" };
    }
    // All turns are done: wait until the head is straight again.
    if (Math.abs(face.turn) > STRAIGHT_MAX_TURN) {
      this.straightSince = null;
      return { type: "none" };
    }
    this.straightSince ??= now;
    if (now - this.straightSince < STRAIGHT_HOLD_MS) return { type: "none" };
    this.finished = true;
    return { type: "take", role: "frontal" };
  }
}
