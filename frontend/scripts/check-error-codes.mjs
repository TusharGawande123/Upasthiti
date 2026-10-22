// Fails (exit code 1) if the server can raise an error code that has no admin text.
// Without this the admin would see "Something went wrong" instead of the real reason (found in
// the M2 review): `check-translations.mjs` cannot see these keys, they are built at runtime
// from the code (errors.<CODE>). Run: npm run i18n:check   (CI runs it on every pull request)
//
// It reads the backend source for ApiError("CODE", ...) and checks errors.<CODE> exists.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const BACKEND_APP = "../backend/app";
const ENGLISH_FILE = "public/locales/en/common.json";

function pythonFiles(folder) {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) return entry.name === "__pycache__" ? [] : pythonFiles(path);
    return entry.name.endsWith(".py") ? [path] : [];
  });
}

const codes = new Set();
for (const file of pythonFiles(BACKEND_APP)) {
  for (const match of readFileSync(file, "utf8").matchAll(/ApiError\(\s*"([A-Z0-9_]+)"/g)) {
    codes.add(match[1]);
  }
}

const texts = JSON.parse(readFileSync(ENGLISH_FILE, "utf8")).errors;
const withoutText = [...codes].filter((code) => !(code in texts)).sort();

if (withoutText.length > 0) {
  console.error("Server error codes without an errors.<CODE> text in common.json:");
  for (const code of withoutText) console.error(`  ${code}`);
  process.exit(1);
}
console.log(`Error codes OK: ${codes.size} server codes, all have an admin text.`);
