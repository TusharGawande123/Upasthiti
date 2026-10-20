// Reading QR codes from the camera (spec M2 §7 rule 9).
//
// Chrome on Android has a built-in BarcodeDetector. Where it is missing (Windows and most
// desktop browsers), the free zxing-wasm decoder is loaded instead. Its .wasm file is served
// from our own site, never from a public CDN, and only on /kiosk (S-28).

export const CARD_PREFIX = "UPS1.";
/** After a result, the same card is ignored this long, so a card still held up is not read twice. */
export const SAME_CARD_IGNORE_MS = 5_000;

/** Quick check on the kiosk: other QR codes (UPI, products) are never sent to the server. */
export function isUpasthitiCard(text: string): boolean {
  return text.startsWith(CARD_PREFIX);
}

/** Remembers the last card that got a result, and for how long it is ignored. */
export class SameCardFilter {
  private lastText: string | null = null;
  private lastAt = 0;

  constructor(private readonly windowMs = SAME_CARD_IGNORE_MS) {}

  shouldIgnore(text: string, nowMs: number): boolean {
    return text === this.lastText && nowMs - this.lastAt < this.windowMs;
  }

  remember(text: string, nowMs: number): void {
    this.lastText = text;
    this.lastAt = nowMs;
  }
}

export type QrDetector = {
  /** The text of the first QR code in the picture, or null. */
  detect: (source: ImageBitmapSource) => Promise<string | null>;
  /** True when the slower WebAssembly decoder is used (reported to the server, S-26). */
  usesFallback: boolean;
};

type DetectorLike = {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue: string }>>;
};

type DetectorClass = {
  new (options: { formats: string[] }): DetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
};

async function nativeDetector(): Promise<DetectorLike | null> {
  const BuiltIn = (globalThis as { BarcodeDetector?: DetectorClass }).BarcodeDetector;
  if (!BuiltIn) return null;
  try {
    const formats = (await BuiltIn.getSupportedFormats?.()) ?? [];
    return formats.includes("qr_code") ? new BuiltIn({ formats: ["qr_code"] }) : null;
  } catch {
    return null;
  }
}

async function wasmDetector(): Promise<DetectorLike> {
  const [{ BarcodeDetector, prepareZXingModule }, { default: wasmUrl }] = await Promise.all([
    import("barcode-detector/ponyfill"),
    import("zxing-wasm/reader/zxing_reader.wasm?url"),
  ]);
  // Without this the decoder would download its .wasm file from jsDelivr.
  prepareZXingModule({
    overrides: {
      locateFile: (path: string, prefix: string) =>
        path.endsWith(".wasm") ? wasmUrl : prefix + path,
    },
  });
  return new BarcodeDetector({ formats: ["qr_code"] });
}

function wrap(detector: DetectorLike, usesFallback: boolean): QrDetector {
  return {
    usesFallback,
    detect: async (source) => {
      const found = await detector.detect(source);
      return found[0]?.rawValue ?? null;
    },
  };
}

export async function createQrDetector(): Promise<QrDetector> {
  const builtIn = await nativeDetector();
  if (builtIn) return wrap(builtIn, false);
  return wrap(await wasmDetector(), true);
}
