// Turns face landmarks from MediaPipe into a pose hint for the person in front of the camera
// (spec M3 §4.9, §4.2). GUIDANCE ONLY: the browser is never trusted. The server checks every
// shot and every punch itself (decision 0016 item 2), so a wrong hint costs a retake, nothing more.
//
// Coordinates are MediaPipe's: 0..1 across the UNMIRRORED camera picture, x to the right.

export type Point = { x: number; y: number };

/** The few landmarks we need, already picked out of MediaPipe's 478. */
export type FaceMarks = {
  leftEyeOuter: Point; // on the picture's left side
  rightEyeOuter: Point; // on the picture's right side
  noseTip: Point;
  mouthCentre: Point;
};

// MediaPipe Face Mesh indices of the points above.
export const LANDMARK_INDEX = {
  leftEyeOuter: 33,
  rightEyeOuter: 263,
  noseTip: 1,
  mouthCentre: 13,
} as const;

export type Measure = {
  /** Nose left/right of the eye centre, in eye distances. > 0: the person turned to THEIR left. */
  turn: number;
  /** Nose height between eyes (0) and mouth (1). Smaller: chin up; bigger: chin down. */
  noseHeight: number;
  /** Eye distance as a share of the picture width: a rough "how big is the face". */
  faceSize: number;
  /** Eye centre, to check that the face is inside the oval. */
  centre: Point;
};

export function measure(marks: FaceMarks): Measure {
  const eyeCentre = {
    x: (marks.leftEyeOuter.x + marks.rightEyeOuter.x) / 2,
    y: (marks.leftEyeOuter.y + marks.rightEyeOuter.y) / 2,
  };
  const eyeDistance = Math.hypot(
    marks.rightEyeOuter.x - marks.leftEyeOuter.x,
    marks.rightEyeOuter.y - marks.leftEyeOuter.y,
  );
  const eyeToMouth = Math.max(marks.mouthCentre.y - eyeCentre.y, 1e-6);
  return {
    // In the unmirrored picture a head turned to the person's own left moves the nose to the
    // picture's right, so a positive value means "their left".
    turn: (marks.noseTip.x - eyeCentre.x) / Math.max(eyeDistance, 1e-6),
    noseHeight: (marks.noseTip.y - eyeCentre.y) / eyeToMouth,
    faceSize: eyeDistance,
    centre: eyeCentre,
  };
}

// Limits for the hints. They are a little looser than the server's checks on purpose: the hint
// should say "hold still" a moment before the server would accept, not after.
const STRAIGHT_MAX_TURN = 0.1;
const TURN_MIN = 0.14;
const TURN_MAX = 0.5;
const NOD_CHANGE = 0.07;
const MIN_FACE_SIZE = 0.12;
const MAX_FACE_SIZE = 0.45;
const MAX_OFF_CENTRE = 0.18;

export type Hint =
  | "no_face"
  | "two_faces"
  | "closer"
  | "farther"
  | "centre"
  | "turn_left"
  | "turn_right"
  | "less_turn"
  | "look_straight"
  | "chin_up"
  | "chin_down"
  | "hold";

export type GuidePose = "straight" | "left" | "right" | "up" | "down";

/**
 * What to tell the person for the wanted pose. `straightNoseHeight` is the nose height measured at
 * the straight shot (people differ, so "chin up" is judged against their own straight face);
 * without it a typical value is used.
 */
export function hintFor(
  pose: GuidePose,
  faces: Measure[],
  straightNoseHeight: number | null,
): Hint {
  if (faces.length === 0) return "no_face";
  if (faces.length > 1) return "two_faces";
  const face = faces[0] as Measure;
  if (face.faceSize < MIN_FACE_SIZE) return "closer";
  if (face.faceSize > MAX_FACE_SIZE) return "farther";
  if (Math.abs(face.centre.x - 0.5) > MAX_OFF_CENTRE || Math.abs(face.centre.y - 0.45) > 0.22) {
    return "centre";
  }
  const baseline = straightNoseHeight ?? 0.5;
  switch (pose) {
    case "straight":
      return Math.abs(face.turn) <= STRAIGHT_MAX_TURN ? "hold" : "look_straight";
    case "left":
      return turnHint(face.turn, "turn_left");
    case "right":
      // The person's right is a negative turn value.
      return turnHint(-face.turn, "turn_right");
    case "up":
      if (Math.abs(face.turn) > STRAIGHT_MAX_TURN) return "look_straight";
      return face.noseHeight <= baseline - NOD_CHANGE ? "hold" : "chin_up";
    case "down":
      if (Math.abs(face.turn) > STRAIGHT_MAX_TURN) return "look_straight";
      return face.noseHeight >= baseline + NOD_CHANGE ? "hold" : "chin_down";
  }
}

function turnHint(turnTowardsWanted: number, moreHint: Hint): Hint {
  if (turnTowardsWanted < TURN_MIN) return moreHint;
  if (turnTowardsWanted > TURN_MAX) return "less_turn";
  return "hold";
}
