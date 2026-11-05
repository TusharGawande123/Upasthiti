// The texts people read never say "kiosk" and every final refusal at the gate and on the phone
// ends politely with "Please visit the plant office." (M3 AC-32, M4 AC-33, M4b AC-45; CLAUDE.md
// section 1 and decisions 0013 and 0022).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type TextTree = { [key: string]: string | string[] | TextTree };

const texts = JSON.parse(
  readFileSync(join(process.cwd(), "public", "locales", "en", "common.json"), "utf8"),
) as TextTree;

// Every text value with the key path that leads to it (keys may say kiosk; the words may not).
function collectTexts(tree: TextTree, path = ""): [string, string][] {
  return Object.entries(tree).flatMap(([key, value]) => {
    const here = path ? `${path}.${key}` : key;
    if (typeof value === "string") return [[here, value] as [string, string]];
    if (Array.isArray(value)) return value.map((line, index) => [`${here}.${index}`, line]);
    return collectTexts(value, here);
  });
}

const FINAL_TITLES = ["NOT ACCEPTED", "SHIFT CLOSED", "ERROR", "NOT SAVED"];
const PLANT_OFFICE_ENDING = /please visit the plant office\.$/i;
// Short retry hints are allowed for camera, light and network problems (decision 0022).
const RETRY_HINT = /(try again|try once more|hold still|scan the code again)/i;

function refusalsOf(group: TextTree): [string, { title: string; next?: string }][] {
  return Object.entries(group)
    .filter(([, value]) => typeof value === "object" && !Array.isArray(value))
    .map(([code, value]) => [code, value as { title: string; next?: string }])
    .filter(([, entry]) => FINAL_TITLES.includes(entry.title));
}

describe("the texts people read", () => {
  it("never use the word kiosk (people say attendance device)", () => {
    const offenders = collectTexts(texts)
      .filter(([, text]) => /\bkiosks?\b/i.test(text))
      .map(([path]) => path);

    expect(offenders).toEqual([]);
  });

  it.each([
    ["the gate", (texts.kiosk as TextTree).punch as TextTree],
    ["the phone", (texts.phone as TextTree).punch as TextTree],
  ])("%s: every final refusal ends with Please visit the plant office.", (_name, group) => {
    const refusals = refusalsOf(group);
    expect(refusals.length).toBeGreaterThan(5);

    const offenders = refusals
      .filter(([, entry]) => {
        const next = entry.next ?? "";
        return !PLANT_OFFICE_ENDING.test(next) && !RETRY_HINT.test(next);
      })
      .map(([code]) => code);

    expect(offenders).toEqual([]);
  });
});
