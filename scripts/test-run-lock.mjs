// The `.test-run.lock` guard for Vitest and Playwright (M6 AC-M6-45, decision 0038). Same file
// format and rules as backend/tests/run_lock.py (read that file's comment first), so pytest, Vitest
// and Playwright see each other:
//   - "pytest" and "vitest" take a SHARED lock of their own kind: a second run of the same kind is
//     refused with "Another test run is active. Wait for it to finish.";
//   - "playwright" takes an EXCLUSIVE lock: it waits for every other run, and blocks new ones;
//   - a holder whose process is gone is ignored; TEST_RUN_LOCK=off switches the guard off.
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// `import.meta.dirname` also works when Vitest loads this file (its import.meta.url is not a file URL).
const THIS_FOLDER = import.meta.dirname ?? dirname(fileURLToPath(import.meta.url));
export const LOCK_FILE = join(THIS_FOLDER, "..", ".test-run.lock");
export const REFUSAL_TEXT = "Another test run is active. Wait for it to finish.";
const EXCLUSIVE_KIND = "playwright";
const MUTEX_STALE_MS = 30_000;
const MUTEX_WAIT_MS = 10_000;
const EXCLUSIVE_POLL_MS = 2_000;

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0); // signal 0 only checks that the process exists
    return true;
  } catch (error) {
    return error.code === "EPERM"; // it exists but belongs to someone else
  }
}

function isSwitchedOff() {
  return (process.env.TEST_RUN_LOCK ?? "").toLowerCase() === "off";
}

export class RunLock {
  constructor(kind, { path = LOCK_FILE, pid = process.pid } = {}) {
    this.kind = kind;
    this.path = path;
    this.pid = pid;
    this.mutex = `${path}.mutex`;
  }

  readLiveHolders() {
    let data;
    try {
      data = JSON.parse(readFileSync(this.path, "utf-8"));
    } catch {
      return [];
    }
    const holders = Array.isArray(data?.holders) ? data.holders : [];
    return holders.filter(
      (holder) =>
        typeof holder?.kind === "string" &&
        holder.pid !== this.pid &&
        isProcessAlive(holder.pid),
    );
  }

  write(holders) {
    writeFileSync(this.path, JSON.stringify({ holders }));
  }

  async takeMutex() {
    const deadline = Date.now() + MUTEX_WAIT_MS;
    for (;;) {
      try {
        mkdirSync(this.mutex);
        return;
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        if (Date.now() - statSync(this.mutex).mtimeMs > MUTEX_STALE_MS) this.dropMutex();
        else if (Date.now() > deadline) throw new Error(REFUSAL_TEXT);
        await sleep(50);
      }
    }
  }

  dropMutex() {
    try {
      rmdirSync(this.mutex);
    } catch {
      // already gone
    }
  }

  /** True when this run now holds its place; false when an exclusive run must wait. */
  async tryTake() {
    await this.takeMutex();
    try {
      const others = this.readLiveHolders();
      if (this.kind === EXCLUSIVE_KIND) {
        if (others.length > 0) return false;
      } else if (
        others.some((other) => other.kind === EXCLUSIVE_KIND || other.kind === this.kind)
      ) {
        throw new Error(REFUSAL_TEXT);
      }
      this.write([...others, { kind: this.kind, pid: this.pid, started: Date.now() / 1000 }]);
      return true;
    } finally {
      this.dropMutex();
    }
  }

  /** Takes the lock or throws. Only the exclusive kind may wait (`waitMs`). */
  async acquire(waitMs = 0) {
    if (isSwitchedOff()) return;
    const deadline = Date.now() + waitMs;
    while (!(await this.tryTake())) {
      if (Date.now() >= deadline) throw new Error(REFUSAL_TEXT);
      await sleep(EXCLUSIVE_POLL_MS);
    }
  }

  async release() {
    if (isSwitchedOff()) return;
    await this.takeMutex();
    try {
      const others = this.readLiveHolders();
      if (others.length > 0) this.write(others);
      else if (existsSync(this.path)) unlinkSync(this.path);
    } finally {
      this.dropMutex();
    }
  }
}
