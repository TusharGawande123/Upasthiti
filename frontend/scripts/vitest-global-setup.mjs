// Vitest global setup: takes the shared "vitest" place in `.test-run.lock` before any test runs
// and gives it back at the end (M6 AC-M6-45; rules in scripts/test-run-lock.mjs). A second Vitest
// run in the same checkout stops here with "Another test run is active. Wait for it to finish."
import { RunLock } from "../../scripts/test-run-lock.mjs";

export default async function setup() {
  const lock = new RunLock("vitest");
  await lock.acquire();
  return async () => {
    await lock.release();
  };
}
