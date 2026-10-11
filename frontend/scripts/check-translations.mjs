// Fails (exit code 1) if the code uses a translation key that is missing from the English file.
// Without this check a missing key would show up on the kiosk as raw text like "kiosk.title".
// Run: npm run i18n:check   (CI runs it on every pull request; spec S-9 / AC-25)
//
// It looks for t("some.key") calls and i18nKey="some.key" props in src/. Keys built at
// runtime (t(`status.${name}`)) cannot be checked this way, so write keys out in full.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE_FOLDER = "src";
const ENGLISH_FILE = "public/locales/en/common.json";
const KEY_PATTERNS = [/\bt\(\s*["']([\w.-]+)["']/g, /\bi18nKey=["']([\w.-]+)["']/g];

/** Turns { health: { connected: "..." } } into ["health.connected"]. */
function flattenKeys(translations, prefix = "") {
  return Object.entries(translations).flatMap(([name, value]) => {
    const key = prefix ? `${prefix}.${name}` : name;
    return typeof value === "object" && value !== null ? flattenKeys(value, key) : [key];
  });
}

function isCheckedSourceFile(fileName) {
  const isCode = fileName.endsWith(".ts") || fileName.endsWith(".tsx");
  const isTest = fileName.includes(".test.") || fileName.startsWith("test/");
  return isCode && !isTest;
}

function findUsedKeys() {
  const usedKeys = new Map(); // key -> first file that uses it
  const files = readdirSync(SOURCE_FOLDER, { recursive: true })
    .map((fileName) => fileName.replaceAll("\\", "/"))
    .filter(isCheckedSourceFile);

  for (const fileName of files) {
    const code = readFileSync(join(SOURCE_FOLDER, fileName), "utf8");
    for (const pattern of KEY_PATTERNS) {
      for (const match of code.matchAll(pattern)) {
        if (!usedKeys.has(match[1])) {
          usedKeys.set(match[1], `${SOURCE_FOLDER}/${fileName}`);
        }
      }
    }
  }
  return usedKeys;
}

const knownKeys = new Set(flattenKeys(JSON.parse(readFileSync(ENGLISH_FILE, "utf8"))));
const usedKeys = findUsedKeys();
const missingKeys = [...usedKeys].filter(([key]) => !knownKeys.has(key));

if (missingKeys.length > 0) {
  console.error(`Missing from ${ENGLISH_FILE}:`);
  for (const [key, fileName] of missingKeys) {
    console.error(`  - ${key}  (used in ${fileName})`);
  }
  process.exit(1);
}

console.log(`Translations OK: ${usedKeys.size} keys used, all present in ${ENGLISH_FILE}.`);
