// The admin's camera for face enrolment (spec M3 §4.9): any laptop webcam or phone camera. The
// picture stays in the browser; each shot is sent once and then dropped. Nothing is kept on
// the device (no local storage, no cache).

export type CameraProblem = "CAMERA_BLOCKED" | "CAMERA_NOT_FOUND";

export class FaceCameraError extends Error {
  constructor(readonly problem: CameraProblem) {
    super(problem);
    this.name = "FaceCameraError";
  }
}

// The server accepts shots 480–1280 px wide, at most 150 KB (spec §5.4). 960 px leaves room.
export const SHOT_MAX_WIDTH = 960;
export const SHOT_MIN_WIDTH = 480;
export const SHOT_MAX_BYTES = 140 * 1024;

export type CameraChoice = { deviceId: string; label: string };

export async function listCameras(): Promise<CameraChoice[]> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((device) => device.kind === "videoinput")
      .map((device, index) => ({
        deviceId: device.deviceId,
        label: device.label || `Camera ${index + 1}`,
      }));
  } catch {
    return [];
  }
}

/** Starts the chosen camera (or the front camera) in `video`. Throws FaceCameraError. */
export async function startFaceCamera(
  video: HTMLVideoElement,
  deviceId: string | null,
): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new FaceCameraError("CAMERA_NOT_FOUND");
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: deviceId
        ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 960 } }
        : { facingMode: { ideal: "user" }, width: { ideal: 1280 }, height: { ideal: 960 } },
    });
  } catch (error) {
    const name =
      typeof error === "object" && error !== null && "name" in error ? String(error.name) : "";
    throw new FaceCameraError(
      name === "NotAllowedError" || name === "SecurityError"
        ? "CAMERA_BLOCKED"
        : "CAMERA_NOT_FOUND",
    );
  }
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play().catch(() => undefined); // the wizard is opened by a click, so play is allowed
  return stream;
}

export function stopFaceCamera(stream: MediaStream | null): void {
  for (const track of stream?.getTracks() ?? []) track.stop();
}

/** The shot size: the camera's own size, but 480–960 px wide, keeping its shape. */
export function shotSize(videoWidth: number, videoHeight: number) {
  const width = Math.min(SHOT_MAX_WIDTH, Math.max(SHOT_MIN_WIDTH, videoWidth));
  const height = Math.round((width * videoHeight) / Math.max(videoWidth, 1));
  return { width, height };
}

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000; // small pieces, so a big array does not overflow the call stack
  for (let start = 0; start < bytes.length; start += chunk) {
    binary += String.fromCharCode(...bytes.subarray(start, start + chunk));
  }
  return btoa(binary);
}

/**
 * Takes one shot from the live picture: an UNMIRRORED JPEG (the server measures the head turn
 * on the real picture), made smaller step by step until it fits. Returns base64 text.
 */
export async function takeShot(video: HTMLVideoElement): Promise<string> {
  const { width, height } = shotSize(video.videoWidth, video.videoHeight);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No 2D canvas");
  context.drawImage(video, 0, 0, width, height);
  let quality = 0.9;
  let blob = await encode(canvas, quality);
  while (blob.size > SHOT_MAX_BYTES && quality > 0.5) {
    quality -= 0.1;
    blob = await encode(canvas, quality);
  }
  return toBase64(blob);
}

function encode(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("JPEG encoding failed"))),
      "image/jpeg",
      quality,
    ),
  );
}
