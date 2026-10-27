// One picture for the face punch (spec M3 §4.3, §5.2): a JPEG of at most 640 x 480 px and 70 KB,
// NOT mirrored (the server measures the head turn on the real picture), kept only in memory
// and never stored on the device. The server re-checks size and content.
import { blobToBase64 } from "./snapshot";

export const FRAME_MAX_WIDTH = 640;
export const FRAME_MAX_HEIGHT = 480;
export const FRAME_MAX_BYTES = 70_000;
const QUALITIES = [0.85, 0.75, 0.65, 0.55, 0.45];

/** The camera's shape scaled to fit inside 640 x 480 (never enlarged). */
export function frameSize(videoWidth: number, videoHeight: number) {
  const scale = Math.min(
    1,
    FRAME_MAX_WIDTH / Math.max(videoWidth, 1),
    FRAME_MAX_HEIGHT / Math.max(videoHeight, 1),
  );
  return {
    width: Math.round(videoWidth * scale),
    height: Math.round(videoHeight * scale),
  };
}

/** The best quality whose file fits in the limit; the smallest file when none fits. */
export async function encodeFrame(encode: (quality: number) => Promise<Blob>): Promise<Blob> {
  let blob = await encode(QUALITIES[0] ?? 0.85);
  for (const quality of QUALITIES.slice(1)) {
    if (blob.size <= FRAME_MAX_BYTES) break;
    blob = await encode(quality);
  }
  return blob;
}

/** Takes the current camera picture as base64 text (no "data:" prefix). */
export async function takeFaceFrame(video: HTMLVideoElement): Promise<string> {
  const { width, height } = frameSize(video.videoWidth, video.videoHeight);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No 2D canvas");
  context.drawImage(video, 0, 0, width, height);
  const blob = await encodeFrame(
    (quality) =>
      new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (result) => (result ? resolve(result) : reject(new Error("JPEG encoding failed"))),
          "image/jpeg",
          quality,
        ),
      ),
  );
  return blobToBase64(blob);
}
