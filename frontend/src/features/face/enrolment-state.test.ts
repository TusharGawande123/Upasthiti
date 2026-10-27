// The steps of the enrolment wizard (spec M3 §4.9, decision 0018): five shots, retake, saving,
// duplicate warning, and the quiet restart when the server closed the session.
import { describe, expect, it } from "vitest";
import { INITIAL_STATE, type WizardState, wizardReducer } from "./enrolment-state";

const started = wizardReducer(INITIAL_STATE, { type: "started", sessionId: "s-1" });

function shots(state: WizardState) {
  if (state.step !== "shots") throw new Error(`expected shots, got ${state.step}`);
  return state;
}

describe("wizardReducer", () => {
  it("starts with five dots, the first one current", () => {
    expect(shots(started).dots).toEqual(["current", "pending", "pending", "pending", "pending"]);
  });

  it("an accepted shot goes to the pose the server names", () => {
    const sent = wizardReducer(started, { type: "shot_sent" });
    expect(shots(sent).dots[0]).toBe("checking");
    const next = wizardReducer(sent, {
      type: "shot_answer",
      accepted: true,
      reasonCode: null,
      nextPose: "left",
    });
    expect(shots(next).poseIndex).toBe(1);
    expect(shots(next).dots.slice(0, 2)).toEqual(["ok", "current"]);
  });

  it("a refused shot keeps the others and offers a retake", () => {
    const refused = wizardReducer(wizardReducer(started, { type: "shot_sent" }), {
      type: "shot_answer",
      accepted: false,
      reasonCode: "ENROL_BLURRY",
      nextPose: "straight",
    });
    expect(shots(refused).failure).toBe("ENROL_BLURRY");
    expect(shots(refused).dots[0]).toBe("failed");
    const retake = wizardReducer(refused, { type: "retake" });
    expect(shots(retake).failure).toBeNull();
    expect(shots(retake).dots[0]).toBe("current");
  });

  it("the fifth accepted shot starts saving", () => {
    const saving = wizardReducer(started, {
      type: "shot_answer",
      accepted: true,
      reasonCode: null,
      nextPose: null,
    });
    expect(saving).toEqual({ step: "saving", sessionId: "s-1", overrideReason: null });
  });

  it("a duplicate needs a reason, then saves again with it", () => {
    const saving = wizardReducer(started, {
      type: "shot_answer",
      accepted: true,
      reasonCode: null,
      nextPose: null,
    });
    const duplicate = wizardReducer(saving, { type: "duplicate", matches: [] });
    expect(duplicate.step).toBe("duplicate");
    expect(wizardReducer(duplicate, { type: "override", reason: "Twins, checked" })).toEqual({
      step: "saving",
      sessionId: "s-1",
      overrideReason: "Twins, checked",
    });
  });

  it("a lost session goes back to the camera check without a 'took too long' screen", () => {
    expect(wizardReducer(started, { type: "session_lost" })).toEqual({
      step: "camera",
      notice: "restarted",
    });
  });

  it("ignores events that do not fit the step", () => {
    expect(wizardReducer(INITIAL_STATE, { type: "retake" })).toBe(INITIAL_STATE);
    expect(wizardReducer(INITIAL_STATE, { type: "override", reason: "x" })).toBe(INITIAL_STATE);
  });
});
