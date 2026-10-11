// The translation-key check fails and names the key when the English file is missing it
// (spec AC-25).
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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
});
