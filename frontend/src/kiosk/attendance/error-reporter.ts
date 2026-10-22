// Small problem reports from the kiosk to the server log (S-26, spec M2 §7 rule 16), so the admin
// learns that a gate's camera failed or that a browser needs the slower decoder.
// - Only a few kinds; the same problem is counted, not sent again and again.
// - At most 20 reports an hour (the server refuses the 21st anyway).
// - Never a card text, a photo or a name: messages are cut to 300 characters and anything that
//   looks like a card text is removed.

export type ReportKind =
  | "camera_error"
  | "decoder_fallback"
  | "script_error"
  | "wake_lock_failed"
  | "other";

export type ReportBody = { kind: ReportKind; message: string; count: number; app_version: string };

export const SEND_EVERY_MS = 60_000;
export const MAX_REPORTS_PER_HOUR = 20;
const HOUR_MS = 60 * 60 * 1000;
const MAX_MESSAGE = 300;
const MAX_COUNT = 100;
const CARD_TEXT = /UPS1\.[A-Z0-9.]*/g;

export function cleanMessage(message: string): string {
  return message.replace(CARD_TEXT, "[card]").replace(/\s+/g, " ").trim().slice(0, MAX_MESSAGE);
}

export class ErrorReporter {
  private waiting = new Map<string, ReportBody>();
  private sentAt: number[] = [];

  constructor(
    private readonly send: (body: ReportBody) => Promise<unknown>,
    private readonly appVersion: string,
    private readonly now: () => number = Date.now,
  ) {}

  /** Remember a problem; it is sent with the next batch. */
  report(kind: ReportKind, message: string): void {
    const cleaned = cleanMessage(message) || kind;
    const key = `${kind}\n${cleaned}`;
    const existing = this.waiting.get(key);
    if (existing) {
      existing.count = Math.min(MAX_COUNT, existing.count + 1);
      return;
    }
    this.waiting.set(key, { kind, message: cleaned, count: 1, app_version: this.appVersion });
  }

  /** Send what is waiting, within the hourly limit. Failed sends are tried again next time. */
  async flush(): Promise<void> {
    const now = this.now();
    this.sentAt = this.sentAt.filter((time) => now - time < HOUR_MS);
    for (const [key, body] of this.waiting) {
      if (this.sentAt.length >= MAX_REPORTS_PER_HOUR) return;
      try {
        this.sentAt.push(now);
        await this.send(body);
        this.waiting.delete(key);
      } catch {
        return; // no internet or the server refused: keep it for the next batch
      }
    }
  }
}
