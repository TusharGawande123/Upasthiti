// The live pose hints of the enrolment wizard: only guidance, the server decides (spec M3 §4.9).
import { describe, expect, it } from "vitest";
import { type FaceMarks, hintFor, type Measure, measure } from "./pose-estimate";

// A face in the middle of the picture. `turn` moves the nose sideways, `nod` moves it up or down.
function face({ turn = 0, nod = 0, size = 0.2, x = 0.5 } = {}): FaceMarks {
  const half = size / 2;
  return {
    leftEyeOuter: { x: x - half, y: 0.4 },
    rightEyeOuter: { x: x + half, y: 0.4 },
    noseTip: { x: x + turn * size, y: 0.4 + (0.5 + nod) * 0.2 },
    mouthCentre: { x, y: 0.6 },
  };
}

const one = (marks: FaceMarks): Measure[] => [measure(marks)];

describe("measure", () => {
  it("reads a straight face as no turn and a middle nose height", () => {
    const result = measure(face());
    expect(result.turn).toBeCloseTo(0);
    expect(result.noseHeight).toBeCloseTo(0.5);
    expect(result.faceSize).toBeCloseTo(0.2);
  });

  it("a nose on the picture's right means the person turned to their own left", () => {
    expect(measure(face({ turn: 0.3 })).turn).toBeGreaterThan(0);
  });
});

describe("hintFor", () => {
  it("says what is wrong before the pose is judged", () => {
    expect(hintFor("straight", [], null)).toBe("no_face");
    expect(hintFor("straight", [measure(face()), measure(face())], null)).toBe("two_faces");
    expect(hintFor("straight", one(face({ size: 0.05 })), null)).toBe("closer");
    expect(hintFor("straight", one(face({ size: 0.6 })), null)).toBe("farther");
    expect(hintFor("straight", one(face({ x: 0.85 })), null)).toBe("centre");
  });

  it("straight: hold when the head is straight", () => {
    expect(hintFor("straight", one(face()), null)).toBe("hold");
    expect(hintFor("straight", one(face({ turn: 0.3 })), null)).toBe("look_straight");
  });

  it("left and right: more, enough, or too much", () => {
    expect(hintFor("left", one(face()), null)).toBe("turn_left");
    expect(hintFor("left", one(face({ turn: 0.25 })), null)).toBe("hold");
    expect(hintFor("left", one(face({ turn: 0.8 })), null)).toBe("less_turn");
    expect(hintFor("right", one(face({ turn: 0.25 })), null)).toBe("turn_right");
    expect(hintFor("right", one(face({ turn: -0.25 })), null)).toBe("hold");
  });

  it("chin up and down are judged against the person's own straight face", () => {
    expect(hintFor("up", one(face()), 0.5)).toBe("chin_up");
    expect(hintFor("up", one(face({ nod: -0.15 })), 0.5)).toBe("hold");
    expect(hintFor("down", one(face()), 0.5)).toBe("chin_down");
    expect(hintFor("down", one(face({ nod: 0.15 })), 0.5)).toBe("hold");
    expect(hintFor("up", one(face({ turn: 0.3, nod: -0.15 })), 0.5)).toBe("look_straight");
  });
});
