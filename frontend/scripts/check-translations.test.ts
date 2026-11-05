// The translation-key check fails and names the key when the English file is missing it
// (spec AC-25).
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function runCheck(componentCode: string, englishTexts: object) {
  const folder = mkdtempSync(join(tmpdir(), "i18n-check-"));
  mkdirSync(join(folder, "src"));
  writeFileSync(join(folder, "src", "page.tsx"), componentCode);
  writeFileSync(join(folder, "en.json"), JSON.stringify(englishTexts));
  return spawnSync(
    process.execPath,
    ["scripts/check-translations.mjs", join(folder, "src"), join(folder, "en.json")],
    { encoding: "utf8" },
  );
}

describe("check-translations script", () => {
  it("passes when every key used in code exists", () => {
    const result = runCheck('t("kiosk.title")', { kiosk: { title: "Kiosk" } });

    expect(result.status).toBe(0);
  });

  it("fails and names the missing key", () => {
    const result = runCheck('t("kiosk.title"); t("kiosk.missing")', { kiosk: { title: "Kiosk" } });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("kiosk.missing");
    expect(result.stderr).not.toContain("kiosk.title");
  });

  it("fails when a gate text group has no next line or steps", () => {
    const result = runCheck("", {
      kiosk: {
        punch: {
          NO_FACE: { title: "A", message: "B" },
          OK: { title: "A", message: "B", next: "C" },
        },
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("kiosk.punch.NO_FACE.next|steps");
    expect(result.stderr).not.toContain("kiosk.punch.OK");
  });
});

// Marathi and Hindi hold only the phone texts (F-99): the real English file is copied next to
// changed copies of the real mr and hi files.
describe("check-translations script, Marathi and Hindi", () => {
  type Texts = Record<string, Record<string, unknown>>;
  const readLocale = (language: string): Texts =>
    JSON.parse(readFileSync(`public/locales/${language}/common.json`, "utf8"));

  function runWith(change: (mr: Texts, hi: Texts) => void) {
    const folder = mkdtempSync(join(tmpdir(), "i18n-lang-"));
    mkdirSync(join(folder, "src"));
    writeFileSync(join(folder, "src", "page.tsx"), "");
    const [english, mr, hi] = ["en", "mr", "hi"].map(readLocale);
    change(mr, hi);
    for (const [language, texts] of [
      ["en", english],
      ["mr", mr],
      ["hi", hi],
    ] as const) {
      mkdirSync(join(folder, "locales", language), { recursive: true });
      writeFileSync(join(folder, "locales", language, "common.json"), JSON.stringify(texts));
    }
    return spawnSync(
      process.execPath,
      [
        "scripts/check-translations.mjs",
        join(folder, "src"),
        join(folder, "locales/en/common.json"),
      ],
      { encoding: "utf8" },
    );
  }

  it("passes for the real files", () => {
    expect(runWith(() => {}).status).toBe(0);
  });

  it("fails and names a phone text missing in Marathi", () => {
    const result = runWith((mr) => {
      delete mr.phone.back;
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("common.json: missing phone.back");
  });

  it("fails when Hindi holds a text outside the phone pages", () => {
    const result = runWith((_mr, hi) => {
      hi.login = { title: "x" };
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("common.json: login.title is outside the phone pages");
  });

  it("fails when a translation loses a placeholder", () => {
    const result = runWith((mr) => {
      (mr.phone.home as Record<string, unknown>).hello = "नमस्कार";
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("phone.home.hello has other {{placeholders}}");
  });
});
