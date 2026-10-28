// The last server time the gate received, and how long ago that was (M4 spec §7 rule 8).
// Every signed answer carries a `time_anchor` that only the server can make. While offline the
// gate does not trust its own clock: it reports "this many milliseconds since the anchor"
// measured with performance.now() (which a person cannot change), plus the wall clock's view for
// comparison. The server decides the punch time from these.

export type TimeAnchor = { server_time: string; counter: number; token: string };

type HeldAnchor = {
  anchor: TimeAnchor;
  receivedMonotonicMs: number;
  receivedWallMs: number;
  sessionId: string;
};

// A new id for every page load: an anchor from before a reload cannot prove a time.
const SESSION_ID = crypto.randomUUID();
const STORAGE_KEY = "upasthiti.timeAnchor";

let held: HeldAnchor | null = null;

/** Called with every signed answer that carries an anchor. */
export function rememberAnchor(anchor: TimeAnchor | null | undefined): void {
  if (!anchor?.token) return;
  held = {
    anchor,
    receivedMonotonicMs: performance.now(),
    receivedWallMs: Date.now(),
    sessionId: SESSION_ID,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(held));
  } catch {
    // Storage blocked: the anchor of this page load still works from memory.
  }
}

function currentAnchor(): HeldAnchor | null {
  if (held) return held;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? (JSON.parse(saved) as HeldAnchor) : null;
  } catch {
    return null;
  }
}

export type ReportedTime = {
  anchor: TimeAnchor;
  elapsed_ms: number;
  wall_elapsed_ms: number;
  same_session: boolean;
  device_time: string;
};

/** What an offline punch reports about its time, or null before the first anchor ever. */
export function reportTime(): ReportedTime | null {
  const current = currentAnchor();
  if (!current) return null;
  const sameSession = current.sessionId === SESSION_ID;
  const wallElapsed = Date.now() - current.receivedWallMs;
  return {
    anchor: current.anchor,
    // After a reload performance.now() starts again from 0, so only the wall clock is left.
    elapsed_ms: sameSession
      ? Math.max(0, Math.round(performance.now() - current.receivedMonotonicMs))
      : 0,
    wall_elapsed_ms: Math.round(wallElapsed),
    same_session: sameSession,
    device_time: new Date().toISOString(),
  };
}

/** The best guess of the server's clock now (for the offline clock on the screen). */
export function serverNowMs(): number | null {
  const current = currentAnchor();
  if (!current) return null;
  const sameSession = current.sessionId === SESSION_ID;
  const elapsed = sameSession
    ? performance.now() - current.receivedMonotonicMs
    : Date.now() - current.receivedWallMs;
  return new Date(current.anchor.server_time).getTime() + elapsed;
}

/** For tests only: forget the anchor of this page load. */
export function forgetAnchorForTests(): void {
  held = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // nothing to forget
  }
}
