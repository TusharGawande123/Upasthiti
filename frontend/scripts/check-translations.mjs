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
import { basename, dirname, join } from "node:path";

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

// --- Marathi and Hindi (F-99) ---
// Only the /phone pages are translated. Each file must hold EVERY phone.* text, the error texts the
// phone pages can show and the few shared texts the phone pages borrow from the gate, and nothing
// else: the admin and gate pages stay English, and a stray key would hide a missing English one.
// The files are found next to the English one (public/locales/<language>/common.json).
const PHONE_LANGUAGES = ["mr", "hi"];
const PHONE_ERROR_CODES = [
  "UNKNOWN",
  "NETWORK_ERROR",
  "INTERNAL_ERROR",
  "VALIDATION_FAILED",
  "FORBIDDEN",
  "NOT_FOUND",
  "TOO_MANY_REQUESTS",
  "PASSWORD_TOO_WEAK",
  "PHONE_CREDENTIALS_INVALID",
  "PHONE_ACCOUNT_LOCKED",
  "PHONE_PUNCH_OFF",
  "PHONE_NEW_PASSWORD_REQUIRED",
  "PHONE_NOT_SIGNED_IN",
  "PHONE_NOTICE_REQUIRED",
  "NOTICE_TEXT_CHANGED",
  "PHONE_FACE_NOT_READY",
  "PROOF_FAILED",
  "PROOF_TOKEN_INVALID",
  "PHONE_RECENT_SIGN_IN_REQUIRED",
  "PASSKEY_INVALID",
  "PASSKEY_LIMIT_REACHED",
  "PASSKEYS_NOT_CONFIGURED",
  "PHONE_SIGNED_OUT_ELSEWHERE",
  "PHONE_BROWSER_UNSUPPORTED",
  "PASSKEY_CANCELLED",
  "PHONE_LOCATION_DENIED",
  "PHONE_NETWORK_OFFLINE",
  "PRIVACY_CONTACT_MISSING",
  "COMPANY_ADDRESS_MISSING",
].map((code) => `errors.${code}`);
// Texts the phone pages share with the gate (the early-out question, the face guide, the camera).
const SHARED_PHONE_KEYS = [
  "gate.earlyOut.tag",
  "gate.earlyOut.half.title",
  "gate.earlyOut.half.consequence",
  "gate.earlyOut.full.title",
  "gate.earlyOut.full.consequence",
  "gate.earlyOut.halfRemaining",
  "gate.earlyOut.fullRemaining",
  "gate.earlyOut.atTime",
  "gate.earlyOut.duration",
  "gate.earlyOut.durationMinutes",
  "gate.earlyOut.agree",
  "gate.earlyOut.cancel",
  "kiosk.attendance.cameraLabel",
  "kiosk.attendance.imReady",
  "kiosk.attendance.photoIn",
  "kiosk.face.cameraLabel",
  "kiosk.face.guideTitle",
  "kiosk.face.hintCloser",
  "kiosk.face.hintFarther",
  "kiosk.face.hintOnePerson",
  "kiosk.face.hintCentre",
  "kiosk.face.hintLight",
  "kiosk.face.good",
  "kiosk.face.turnLeft",
  "kiosk.face.turnRight",
  "kiosk.face.left",
  "kiosk.face.right",
  "kiosk.face.guideTimeout",
  "kiosk.face.straightAgain",
  "kiosk.punch.CAMERA_BLOCKED.title",
  "kiosk.punch.CAMERA_BLOCKED.message",
  "kiosk.punch.CAMERA_BLOCKED.steps.0",
  "kiosk.punch.CAMERA_BLOCKED.steps.1",
  "kiosk.punch.CAMERA_BLOCKED.steps.2",
];

function placeholdersOf(text) {
  return (String(text).match(/\{\{\w+\}\}/g) ?? []).sort().join(",");
}

function languageFileFor(language) {
  const folder = dirname(ENGLISH_FILE);
  if (basename(folder) !== "en") return null; // a test with a lone English file
  return join(dirname(folder), language, "common.json");
}

function checkPhoneLanguages() {
  const required = [
    ...[...knownKeys].filter((key) => key.startsWith("phone.")),
    ...PHONE_ERROR_CODES,
    ...SHARED_PHONE_KEYS,
  ];
  const allowed = new Set(required);
  const problems = [];
  const files = PHONE_LANGUAGES.map(languageFileFor).filter((file) => file !== null);
  if (files.length === 0) return problems;
  for (const key of required.filter((key) => !knownKeys.has(key))) {
    problems.push(`${ENGLISH_FILE}: ${key} is on the phone list but missing in English`);
  }
  for (const file of files) {
    const present = new Set(flattenKeys(JSON.parse(readFileSync(file, "utf8"))));
    for (const key of required.filter((key) => !present.has(key))) {
      problems.push(`${file}: missing ${key}`);
    }
    for (const key of [...present].filter((key) => !allowed.has(key))) {
      problems.push(`${file}: ${key} is outside the phone pages (only English has it)`);
    }
    // A text that loses a {{name}} or {{time}} would show an empty gap to the worker.
    const translated = JSON.parse(readFileSync(file, "utf8"));
    for (const key of required.filter((key) => present.has(key) && knownKeys.has(key))) {
      if (placeholdersOf(valueAt(translated, key)) !== placeholdersOf(valueAt(englishTexts, key))) {
        problems.push(`${file}: ${key} has other {{placeholders}} than the English text`);
      }
    }
  }
  return problems;
}

const phoneProblems = checkPhoneLanguages();
if (phoneProblems.length > 0) {
  console.error("Marathi and Hindi phone texts are not complete or hold other texts:");
  for (const problem of phoneProblems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(`Translations OK: ${usedKeys.size} keys used, all present in ${ENGLISH_FILE}.`);
