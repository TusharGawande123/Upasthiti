// The low-light hint (F-31): the kiosk measures a tiny copy of the camera picture once a second.
// When it stays darker than the server's threshold for 10 seconds, the hint "Too dark. Please
// switch on the gate light." appears; it goes away as soon as the picture is bright again.
// Only a hint: punching still works, and the server measures the stored photo itself.

export const DARK_HOLD_MS = 10_000;
const SAMPLE_WIDTH = 64;
const SAMPLE_HEIGHT = 48;

/** Average brightness 0-255 of RGBA pixels, with the same weights the server uses (ITU-R 601). */
export function averageBrightness(rgba: Uint8ClampedArray): number {
  const pixels = rgba.length / 4;
  if (pixels === 0) return 0;
  let total = 0;
  for (let index = 0; index < rgba.length; index += 4) {
    const red = rgba[index] ?? 0;
    const green = rgba[index + 1] ?? 0;
    const blue = rgba[index + 2] ?? 0;
    total += 0.299 * red + 0.587 * green + 0.114 * blue;
  }
  return Math.round(total / pixels);
}

export class LowLightWatcher {
  private darkSince: number | null = null;

  constructor(
    private readonly threshold: number,
    private readonly holdMs = DARK_HOLD_MS,
  ) {}

  /** Feed one measurement; returns whether the hint should show now. */
  update(brightness: number, nowMs: number): boolean {
    if (brightness >= this.threshold) {
      this.darkSince = null;
      return false;
    }
    this.darkSince ??= nowMs;
    return nowMs - this.darkSince >= this.holdMs;
  }
}

/** Brightness of the current camera picture, measured on a 64 x 48 copy. */
export function measureVideoBrightness(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
): number | null {
  canvas.width = SAMPLE_WIDTH;
  canvas.height = SAMPLE_HEIGHT;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context || video.videoWidth === 0) return null;
  context.drawImage(video, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
  return averageBrightness(context.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT).data);
}
