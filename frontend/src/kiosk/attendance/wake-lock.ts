// Keeps the gate screen awake (S-29, spec M2 §7 rule 9). The browser's Screen Wake Lock is asked
// for after the banner tap and again whenever the page becomes visible (the browser drops the
// lock when the tab is hidden). A refusal is reported once; the setup guide explains the
// device's own power settings as the fallback.

type WakeLockApi = { request: (type: "screen") => Promise<{ released: boolean }> };

export class WakeLockKeeper {
  private wanted = false;
  private reportedFailure = false;

  constructor(private readonly onFailure: (reason: string) => void) {
    document.addEventListener("visibilitychange", () => {
      if (this.wanted && document.visibilityState === "visible") void this.request();
    });
  }

  /** Start keeping the screen awake (after the banner tap). Returns whether it worked. */
  async start(): Promise<boolean> {
    this.wanted = true;
    return this.request();
  }

  private async request(): Promise<boolean> {
    const api = (navigator as { wakeLock?: WakeLockApi }).wakeLock;
    try {
      if (!api) throw new Error("Screen Wake Lock is not supported by this browser");
      await api.request("screen");
      return true;
    } catch (error) {
      if (!this.reportedFailure) {
        this.reportedFailure = true;
        this.onFailure(error instanceof Error ? error.message : "Wake lock refused");
      }
      return false;
    }
  }
}
