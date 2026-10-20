// The kiosk updates itself (S-27, spec M2 §4.2): every 5 minutes it reads the site's
// /version.json (written by the build). When a newer build is live, it reloads the next time
// the screen has been idle (scanning, no punch) for 30 seconds, so never in the middle of a punch.

export const CHECK_EVERY_MS = 5 * 60_000;
export const IDLE_BEFORE_RELOAD_MS = 30_000;

/** Is a different build live? A "dev" build never updates itself. */
export async function newVersionIsLive(
  currentVersion: string,
  fetchVersion: () => Promise<string | null> = readLiveVersion,
): Promise<boolean> {
  if (currentVersion === "dev") return false;
  const live = await fetchVersion().catch(() => null);
  return live !== null && live !== currentVersion;
}

export async function readLiveVersion(): Promise<string | null> {
  const response = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) return null;
  const body = (await response.json()) as { version?: unknown };
  return typeof body.version === "string" ? body.version : null;
}

/** Reload only when an update waits and the screen has been idle long enough. */
export function readyToReload(
  updateWaiting: boolean,
  idleSinceMs: number | null,
  nowMs: number,
): boolean {
  return updateWaiting && idleSinceMs !== null && nowMs - idleSinceMs >= IDLE_BEFORE_RELOAD_MS;
}
