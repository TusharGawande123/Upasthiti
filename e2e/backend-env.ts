// The backend's environment for the end-to-end tests. Shared by playwright.config.ts (which
// starts the server) and the tests (which make card clips with the same signing key).
//
// The two keys are made from fixed phrases at run time, so the same key is used everywhere in a
// run and no key-like text is stored in this public repository. They protect nothing real.
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

function testKey(phrase: string): string {
  return createHash("sha256").update(phrase).digest("base64url"); // 32 bytes, as the server wants
}

// M4: a P-256 private key (PKCS#8 DER, base64url) whose secret number is the hash of a phrase.
// The fixed prefix is the PKCS#8 wrapper of a P-256 key without its public part; the server
// works the public key out itself.
const P256_PKCS8_PREFIX = "3041020100301306072a8648ce3d020106082a8648ce3d030107042730250201010420";
function testOfflineKey(phrase: string): string {
  const secret = createHash("sha256").update(phrase).digest();
  return Buffer.concat([Buffer.from(P256_PKCS8_PREFIX, "hex"), secret]).toString("base64url");
}

export const FRONTEND_URL = "http://localhost:5173";
export const BACKEND_FOLDER = fileURLToPath(new URL("../backend", import.meta.url));
/** Card clips and the punch photos of a run; git-ignored (e2e/.gitignore). */
export const TMP_FOLDER = fileURLToPath(new URL("./.tmp", import.meta.url));

// The name must end in _e2e: the seed script refuses any other database.
const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  "postgresql+psycopg://upasthiti:upasthiti@127.0.0.1:5432/upasthiti_e2e";

export const BACKEND_ENV: Record<string, string> = {
  APP_ENV: "test",
  RUN_SCHEDULER: "false",
  // One run logs in many times from one laptop (the limit is 20 per 10 minutes).
  E2E_LOGIN_LIMIT: "500",
  // The gate tests pair many devices from one laptop (the limit is 10 per 10 minutes).
  E2E_PAIRING_LIMIT: "200",
  DATABASE_URL: E2E_DATABASE_URL,
  // Fake values, used only by these tests.
  APP_SECRET_KEY: "e2e-only-secret-key-not-used-anywhere-else-0123",
  APP_PUBLIC_ORIGIN: FRONTEND_URL,
  QR_SIGNING_KEY: testKey("upasthiti end-to-end tests: QR card signing"),
  QR_SIGNING_KEY_ID: "A",
  SNAPSHOT_ENCRYPTION_KEY: testKey("upasthiti end-to-end tests: snapshot encryption"),
  // M3: a stand-in for the face models (test only) and a key for the face templates.
  FACE_ENGINE: "fake",
  FACE_TEMPLATE_KEY: testKey("upasthiti end-to-end tests: face template encryption"),
  // M4: opens the punches the gate saved while offline.
  OFFLINE_EVIDENCE_KEY: testOfflineKey("upasthiti end-to-end tests: offline evidence"),
  STORAGE_BACKEND: "local",
  STORAGE_LOCAL_DIR: `${TMP_FOLDER}/storage`,
};
