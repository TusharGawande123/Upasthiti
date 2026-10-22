// Starting the gate camera (spec M2 §4.1). The picture stays in the browser; only the single
// snapshot of a card punch is ever sent.

export type CameraProblem = "CAMERA_BLOCKED" | "CAMERA_NOT_FOUND";

export class CameraError extends Error {
  constructor(readonly problem: CameraProblem | "NEEDS_TAP") {
    super(problem);
    this.name = "CameraError";
  }
}

function problemFor(error: unknown): CameraProblem {
  // Browsers throw a DOMException, which is not an Error subclass everywhere: read its name.
  const name =
    typeof error === "object" && error !== null && "name" in error ? String(error.name) : "";
  // The person (or a policy) said no to the camera for this site.
  if (name === "NotAllowedError" || name === "SecurityError") return "CAMERA_BLOCKED";
  // No camera, a camera that cannot give a picture, or one used by another app.
  return "CAMERA_NOT_FOUND";
}

/**
 * Asks for the camera and shows it in `video`. Throws CameraError:
 * - CAMERA_BLOCKED / CAMERA_NOT_FOUND: the screen explains how to fix it;
 * - NEEDS_TAP: the browser wants one tap before the picture can play ("Start camera" button).
 */
export async function startCamera(video: HTMLVideoElement): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new CameraError("CAMERA_NOT_FOUND");
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      // The front camera faces the worker on a phone or tablet; a PC has only one camera.
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
    });
  } catch (error) {
    throw new CameraError(problemFor(error));
  }
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  try {
    await video.play();
  } catch {
    // The stream is ready; it only needs a tap to play. Keep it attached for playAfterTap().
    throw new CameraError("NEEDS_TAP");
  }
  return stream;
}

/** Called from the "Start camera" button, which counts as the tap the browser wanted. */
export async function playAfterTap(video: HTMLVideoElement): Promise<void> {
  await video.play();
}

export function stopCamera(stream: MediaStream | null): void {
  for (const track of stream?.getTracks() ?? []) track.stop();
}
