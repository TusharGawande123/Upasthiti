// Runs once before the end-to-end tests:
//  - takes the exclusive "playwright" place in `.test-run.lock` (it waits for any running pytest or
//    Vitest run to finish, and nothing else may start meanwhile; M6 AC-M6-45, decision 0038) and
//    gives it back at the end;
//  - removes the card clips and punch photos of earlier runs (the test database is wiped at every
//    run too, so those photos belong to nothing).
import { rmSync } from "node:fs";
import { RunLock } from "../scripts/test-run-lock.mjs";
import { TMP_FOLDER } from "./backend-env";

const WAIT_FOR_OTHER_RUNS_MS = 30 * 60 * 1000;

export default async function globalSetup() {
  const lock = new RunLock("playwright");
  await lock.acquire(WAIT_FOR_OTHER_RUNS_MS);
  rmSync(TMP_FOLDER, { recursive: true, force: true });
  return async () => {
    await lock.release();
  };
}
