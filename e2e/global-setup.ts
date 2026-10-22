// Runs once before the end-to-end tests: removes the card clips and punch photos of earlier
// runs (the test database is wiped at every run too, so those photos belong to nothing).
import { rmSync } from "node:fs";
import { TMP_FOLDER } from "./backend-env";

export default function globalSetup() {
  rmSync(TMP_FOLDER, { recursive: true, force: true });
}
