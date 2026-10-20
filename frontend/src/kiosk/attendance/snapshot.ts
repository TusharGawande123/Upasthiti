// The one photo sent with a card punch (spec M2 §7 rule 4): 320 px wide JPEG, made smaller step
// by step until it is at most 15 KB (never below quality 0.4). Nothing is kept on the device.

export const SNAPSHOT_WIDTH = 320;
export const TARGET_BYTES = 15 * 1024;
const START_QUALITY = 0.8;
const MIN_QUALITY = 0.4;
const QUALITY_STEP = 0.1;
// The server accepts heights from 120 to 640 px.
const MIN_HEIGHT = 120;
const MAX_HEIGHT = 640;

/** 320 px wide, keeping the camera's shape (4:3 gives 240, 16:9 gives 180). */
export function snapshotSize(videoWidth: number, videoHeight: number) {
  const height = Math.round((SNAPSHOT_WIDTH * videoHeight) / Math.max(videoWidth, 1));
  return {
    width: SNAPSHOT_WIDTH,
    height: Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, height)),
  };
}

/**
 * Tries quality 0.8, 0.7, ... 0.4 and returns the first file that fits in 15 KB. If none fits,
 * the 0.4 file is used (the server still accepts up to 40 KB).
 */
export async function encodeWithinLimit(encode: (quality: number) => Promise<Blob>): Promise<Blob> {
  let quality = START_QUALITY;
  let blob = await encode(quality);
  while (blob.size > TARGET_BYTES && quality - QUALITY_STEP >= MIN_QUALITY - 1e-9) {
    quality = Math.round((quality - QUALITY_STEP) * 10) / 10;
    blob = await encode(quality);
  }
  return blob;
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000; // keep each call small, so big arrays do not overflow the stack
  for (let start = 0; start < bytes.length; start += chunk) {
    binary += String.fromCharCode(...bytes.subarray(start, start + chunk));
  }
  return btoa(binary);
}

/** Takes the photo from the live camera picture. Returns base64 text (no "data:" prefix). */
export async function takeSnapshot(video: HTMLVideoElement): Promise<string> {
  const { width, height } = snapshotSize(video.videoWidth, video.videoHeight);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No 2D canvas");
  // Not mirrored: the stored photo shows the scene as it really is.
  context.drawImage(video, 0, 0, width, height);
  const blob = await encodeWithinLimit(
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
