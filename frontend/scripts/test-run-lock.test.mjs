// M6 AC-M6-45: the `.test-run.lock` logic of scripts/test-run-lock.mjs, with its own lock file in a
// temporary folder and a real second process as "another run".
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isProcessAlive, REFUSAL_TEXT, RunLock } from "../../scripts/test-run-lock.mjs";

let lockPath;
let sleepers = [];

function startOtherRun() {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
  sleepers.push(child);
  return child.pid;
}

function holdersInFile() {
  return JSON.parse(readFileSync(lockPath, "utf-8")).holders;
}

beforeEach(() => {
  lockPath = join(mkdtempSync(join(tmpdir(), "run-lock-")), ".test-run.lock");
  delete process.env.TEST_RUN_LOCK;
});

afterEach(() => {
  for (const child of sleepers) child.kill();
  sleepers = [];
});

describe("test-run lock", () => {
  it("refuses a second run of the same kind", async () => {
    await new RunLock("vitest", { path: lockPath, pid: startOtherRun() }).acquire();

    await expect(new RunLock("vitest", { path: lockPath }).acquire()).rejects.toThrow(REFUSAL_TEXT);
  });

  it("lets pytest and vitest run together", async () => {
    await new RunLock("pytest", { path: lockPath, pid: startOtherRun() }).acquire();

    await new RunLock("vitest", { path: lockPath }).acquire();

    expect(
      holdersInFile()
        .map((holder) => holder.kind)
        .sort(),
    ).toEqual(["pytest", "vitest"]);
  });

  it("ignores a holder whose process is gone", async () => {
    writeFileSync(
      lockPath,
      JSON.stringify({ holders: [{ kind: "vitest", pid: 2999999, started: 1 }] }),
    );
    expect(isProcessAlive(2999999)).toBe(false);

    await new RunLock("vitest", { path: lockPath }).acquire();

    expect(holdersInFile()).toHaveLength(1);
  });

  it("removes the file when the last run is done", async () => {
    const lock = new RunLock("vitest", { path: lockPath });
    await lock.acquire();

    await lock.release();

    expect(existsSync(lockPath)).toBe(false);
  });

  it("makes playwright wait for others and blocks new runs while it runs", async () => {
    const otherPid = startOtherRun();
    const other = new RunLock("pytest", { path: lockPath, pid: otherPid });
    await other.acquire();
    await expect(new RunLock("playwright", { path: lockPath }).acquire(0)).rejects.toThrow(
      REFUSAL_TEXT,
    );

    await other.release();
    await new RunLock("playwright", { path: lockPath, pid: otherPid }).acquire(0);

    await expect(new RunLock("vitest", { path: lockPath }).acquire()).rejects.toThrow(REFUSAL_TEXT);
  });

  it("can be switched off with TEST_RUN_LOCK=off", async () => {
    await new RunLock("vitest", { path: lockPath, pid: startOtherRun() }).acquire();
    process.env.TEST_RUN_LOCK = "off";

    await new RunLock("vitest", { path: lockPath }).acquire();
  });
});
