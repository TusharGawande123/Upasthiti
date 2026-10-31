// The admin camera helpers: listing cameras, starting one (and the two kinds of failure),
// stopping it, the shot size and taking a shot that is made smaller until it fits.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FaceCameraError,
  listCameras,
  SHOT_MAX_BYTES,
  shotSize,
  startFaceCamera,
  stopFaceCamera,
  takeShot,
} from "./face-camera";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubMediaDevices(value: unknown) {
  vi.stubGlobal("navigator", { mediaDevices: value });
}

function fakeVideo() {
  return {
    play: vi.fn().mockResolvedValue(undefined),
    videoWidth: 1280,
    videoHeight: 960,
  } as never;
}

describe("listCameras", () => {
  it("lists only video inputs and names the unnamed ones", async () => {
    stubMediaDevices({
      enumerateDevices: async () => [
        { kind: "videoinput", deviceId: "a", label: "Front camera" },
        { kind: "audioinput", deviceId: "m", label: "Mic" },
        { kind: "videoinput", deviceId: "b", label: "" },
      ],
    });
    expect(await listCameras()).toEqual([
      { deviceId: "a", label: "Front camera" },
      { deviceId: "b", label: "Camera 2" },
    ]);
  });

  it("returns an empty list when the browser refuses", async () => {
    stubMediaDevices({
      enumerateDevices: async () => {
        throw new Error("no");
      },
    });
    expect(await listCameras()).toEqual([]);
  });
});

describe("startFaceCamera", () => {
  it("starts the front camera, or the chosen one", async () => {
    const stream = { getTracks: () => [] };
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    stubMediaDevices({ getUserMedia });
    const video = fakeVideo() as { srcObject?: unknown };
    expect(await startFaceCamera(video as never, null)).toBe(stream);
    expect(video.srcObject).toBe(stream);
    await startFaceCamera(fakeVideo(), "cam-2");
    expect(getUserMedia.mock.calls[1][0].video.deviceId).toEqual({ exact: "cam-2" });
  });

  it("says when there is no camera support", async () => {
    stubMediaDevices(undefined);
    await expect(startFaceCamera(fakeVideo(), null)).rejects.toMatchObject({
      problem: "CAMERA_NOT_FOUND",
    });
  });

  it("tells a blocked camera from a missing one", async () => {
    stubMediaDevices({
      getUserMedia: vi.fn().mockRejectedValue({ name: "NotAllowedError" }),
    });
    await expect(startFaceCamera(fakeVideo(), null)).rejects.toBeInstanceOf(FaceCameraError);
    await expect(startFaceCamera(fakeVideo(), null)).rejects.toMatchObject({
      problem: "CAMERA_BLOCKED",
    });
    stubMediaDevices({ getUserMedia: vi.fn().mockRejectedValue("odd") });
    await expect(startFaceCamera(fakeVideo(), null)).rejects.toMatchObject({
      problem: "CAMERA_NOT_FOUND",
    });
  });
});

describe("stopFaceCamera and shotSize", () => {
  it("stops every track and accepts no stream", () => {
    const stop = vi.fn();
    stopFaceCamera({ getTracks: () => [{ stop }, { stop }] } as never);
    expect(stop).toHaveBeenCalledTimes(2);
    stopFaceCamera(null);
  });

  it("keeps the shot between 480 and 960 px wide and the same shape", () => {
    expect(shotSize(1920, 1080)).toEqual({ width: 960, height: 540 });
    expect(shotSize(320, 240)).toEqual({ width: 480, height: 360 });
    expect(shotSize(640, 480)).toEqual({ width: 640, height: 480 });
  });
});

describe("takeShot", () => {
  function stubCanvas(sizeFor: (quality: number) => number, hasContext = true) {
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => (hasContext ? { drawImage: vi.fn() } : null),
      toBlob: (done: (blob: Blob | null) => void, _type: string, quality: number) =>
        done(new Blob([new Uint8Array(sizeFor(quality))])),
    };
    vi.spyOn(document, "createElement").mockReturnValue(canvas as never);
  }

  it("returns base64 text of a small picture", async () => {
    stubCanvas(() => 3);
    expect(await takeShot(fakeVideo())).toBe(btoa("\0\0\0"));
  });

  it("makes the picture smaller step by step until it fits", async () => {
    const qualities: number[] = [];
    stubCanvas((quality) => {
      qualities.push(quality);
      return quality > 0.75 ? SHOT_MAX_BYTES + 1 : 10;
    });
    await takeShot(fakeVideo());
    expect(qualities.length).toBeGreaterThan(1);
  });

  it("fails when there is no 2D canvas or the picture cannot be encoded", async () => {
    stubCanvas(() => 1, false);
    await expect(takeShot(fakeVideo())).rejects.toThrow("No 2D canvas");
    vi.restoreAllMocks();
    vi.spyOn(document, "createElement").mockReturnValue({
      getContext: () => ({ drawImage: vi.fn() }),
      toBlob: (done: (blob: Blob | null) => void) => done(null),
    } as never);
    await expect(takeShot(fakeVideo())).rejects.toThrow("JPEG encoding failed");
  });
});
