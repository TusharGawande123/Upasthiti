// The head turn an attendance device chooses by itself when it saves a face punch offline (spec
// M4 §4.4, §7 rule 10): from the number of steps the server sent, with a secure random bit, so
// both turns are possible and neither is favoured.
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SCREEN_SETTINGS } from "./punch-types";
import { localChallenge } from "./use-face-punch";

const FACE = DEFAULT_SCREEN_SETTINGS.face;

function randomByte(value: number) {
  vi.spyOn(crypto, "getRandomValues").mockImplementation(((array: Uint8Array) => {
    array[0] = value;
    return array;
  }) as typeof crypto.getRandomValues);
}

afterEach(() => vi.restoreAllMocks());

describe("the head turn chosen by the device", () => {
  it("picks one of the two single turns, by the lowest random bit", () => {
    randomByte(0);
    expect(localChallenge(1, FACE).challenge).toBe("turn_left");
    randomByte(1);
    expect(localChallenge(1, FACE).challenge).toBe("turn_right");
    randomByte(254); // only the lowest bit counts
    expect(localChallenge(1, FACE).challenge).toBe("turn_left");
    randomByte(255);
    expect(localChallenge(1, FACE).challenge).toBe("turn_right");
  });

  it("picks one of the two ordered turns when the server asks for two steps", () => {
    randomByte(0);
    expect(localChallenge(2, FACE).challenge).toBe("left_then_right");
    randomByte(1);
    expect(localChallenge(2, FACE).challenge).toBe("right_then_left");
  });

  it("carries the capture rules and the minimum turn of the face settings", () => {
    randomByte(0);

    const challenge = localChallenge(1, { ...FACE, min_yaw_degrees: 22 });

    expect(challenge.capture).toMatchObject({ min_frames: 2, max_frames: 4, min_yaw_degrees: 22 });
    expect(challenge.challenge_nonce).toBe(""); // nothing to send back: the server did not choose it
  });
});
