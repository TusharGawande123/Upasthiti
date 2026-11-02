// Fails (exit code 1) if the code uses a translation key that is missing from the English file.
// Without this check a missing key would show up on the kiosk as raw text like "kiosk.title".
// Run: npm run i18n:check   (CI runs it on every pull request; spec S-9 / AC-25)
// Optional arguments (used by its test): <source folder> <English JSON file>
//
// It looks for t("some.key") calls and i18nKey="some.key" props in src/. Keys built at
// runtime (t(`status.${name}`)) cannot be checked this way, so write keys out in full.
// The families of runtime keys whose pieces we can list (kiosk.punch.<CODE>.*, phone.punch.<CODE>.*,
// kiosk.problem.<NAME>.*) are checked for completeness instead: every entry must carry all its parts.
// The server error codes (errors.<CODE>) are checked by check-error-codes.mjs, which `npm run
// i18n:check` runs right after this one.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const [SOURCE_FOLDER = "src", ENGLISH_FILE = "public/locales/en/common.json"] =
  process.argv.slice(2);
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
// i18next stores plurals as "key_one" / "key_other"; the code still asks for plain "key".
const isKnown = (key) =>
  knownKeys.has(key) || knownKeys.has(`${key}_one`) || knownKeys.has(`${key}_other`);
const missingKeys = [...usedKeys].filter(([key]) => !isKnown(key));

// family path -> the parts every entry needs. Each part may be satisfied by any of its alternatives
// (the gate screens for a camera problem show "steps" instead of one "next" line).
// Entries that are plain texts, not groups (locating, newCode ...), are skipped on purpose.
const FAMILIES = {
  "kiosk.punch": [["title"], ["message"], ["next", "steps"]],
  "phone.punch": [["title"], ["message"], ["next"]],
  "kiosk.problem": [["title"], ["message"], ["steps"]],
};

function valueAt(translations, path) {
  return path.split(".").reduce((node, part) => node?.[part], translations);
}

function findIncompleteFamilyEntries(translations) {
  const incomplete = [];
  for (const [familyPath, parts] of Object.entries(FAMILIES)) {
    const family = valueAt(translations, familyPath);
    if (typeof family !== "object" || family === null) continue; // not in this file (tests)
    for (const [entryName, entry] of Object.entries(family)) {
      if (typeof entry !== "object" || entry === null) continue;
      for (const alternatives of parts) {
        if (!alternatives.some((part) => part in entry)) {
          incomplete.push(`${familyPath}.${entryName}.${alternatives.join("|")}`);
        }
      }
    }
  }
  return incomplete;
}

const englishTexts = JSON.parse(readFileSync(ENGLISH_FILE, "utf8"));
const incompleteEntries = findIncompleteFamilyEntries(englishTexts);
if (incompleteEntries.length > 0) {
  console.error(`Incomplete text groups in ${ENGLISH_FILE}:`);
  for (const key of incompleteEntries) console.error(`  - ${key}`);
  process.exit(1);
}

if (missingKeys.length > 0) {
  console.error(`Missing from ${ENGLISH_FILE}:`);
  for (const [key, fileName] of missingKeys) {
    console.error(`  - ${key}  (used in ${fileName})`);
  }
  process.exit(1);
}

console.log(`Translations OK: ${usedKeys.size} keys used, all present in ${ENGLISH_FILE}.`);
