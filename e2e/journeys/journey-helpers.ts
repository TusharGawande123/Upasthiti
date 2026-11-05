// Helpers shared by the journeys (M6): a second signed-in person next to the first, answers that
// are checked for a refusal, a file download that waits for "still being calculated", and the
// read-back of a downloaded file through backend/app/scripts/e2e_read_file.py (test-only).
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { type Browser, expect, type Page } from "@playwright/test";
import { BACKEND_ENV, BACKEND_FOLDER, FRONTEND_URL, TMP_FOLDER } from "../backend-env";
import { adminApi, logIn } from "../tests/helpers";

/** A person signed in in a context of their own, so two roles can be used in one journey. */
export async function openAs(browser: Browser, login: string, welcome: string | RegExp) {
  const context = await browser.newContext({ baseURL: FRONTEND_URL, locale: "en-IN" });
  const page = await context.newPage();
  await logIn(page, login);
  await expect(page.getByText(welcome)).toBeVisible();
  return { page, api: adminApi(page), close: () => context.close() };
}

/** The status and body of a call that is expected to be refused (no assertion on success). */
export async function tryCall(
  page: Page,
  method: "get" | "post",
  path: string,
  body?: unknown,
): Promise<{ status: number; json: { error?: { code?: string } } & Record<string, unknown> }> {
  const response = await page.request[method](`/api/v1${path}`, {
    headers: { Origin: FRONTEND_URL },
    data: body,
  });
  const text = await response.text();
  return { status: response.status(), json: text ? JSON.parse(text) : {} };
}

/**
 * Downloads a file through the logged-in session and saves it under e2e/.tmp. A period that is
 * "still being calculated" (409 ATTENDANCE_PREPARING) is asked again until the file is ready, so
 * no fixed wait is needed.
 */
export async function downloadFile(
  page: Page,
  path: string,
  fileName: string,
  method: "get" | "post" = "get",
  body?: unknown,
): Promise<string> {
  mkdirSync(TMP_FOLDER, { recursive: true });
  const target = `${TMP_FOLDER}/${fileName}`;
  await expect
    .poll(
      async () => {
        const response = await page.request[method](`/api/v1${path}`, {
          headers: { Origin: FRONTEND_URL },
          data: body,
        });
        if (response.status() === 200) {
          writeFileSync(target, await response.body());
          return "ready";
        }
        return `${response.status()} ${await response.text()}`;
      },
      { message: `download of ${path}`, timeout: 90_000, intervals: [1_000, 2_000, 3_000] },
    )
    .toBe("ready");
  return target;
}

export type ReadXlsx = { kind: "xlsx"; sheets: Array<{ name: string; rows: string[][] }> };
export type ReadPdf = { kind: "pdf"; pages: number; text: string[] };
export type ReadZip = {
  kind: "zip";
  names: string[];
  manifest: {
    total_rows: number;
    files: Array<{ file: string; table: string; rows: number }>;
  } | null;
};

/** Opens a downloaded file again (the file itself, not the screen) and returns what it holds. */
export function readBack<T extends ReadXlsx | ReadPdf | ReadZip>(filePath: string): T {
  const output = execFileSync(
    "uv",
    ["run", "python", "-m", "app.scripts.e2e_read_file", filePath],
    { cwd: BACKEND_FOLDER, env: { ...process.env, ...BACKEND_ENV }, encoding: "utf8" },
  );
  // uv may print a line of its own first: the JSON is the last line.
  const lastLine = output.trim().split("\n").at(-1) ?? "";
  return JSON.parse(lastLine) as T;
}

/** The row of a register sheet that starts with this employee code, with its column headers. */
export function registerRow(
  file: ReadXlsx,
  employeeCode: string,
): { header: string[]; row: string[] } {
  for (const sheet of file.sheets) {
    const header = sheet.rows.find(
      (row) => row[0] === "Code" && row[1] === "Name" && row.includes("02"),
    );
    const row = sheet.rows.find((candidate) => candidate[0] === employeeCode);
    if (header && row) return { header, row };
  }
  throw new Error(`No register sheet has a row for ${employeeCode}.`);
}

/** The cell of a row under a column header (a day as "02", or a total such as "Leave"). */
export function cellUnder(table: { header: string[]; row: string[] }, columnName: string): string {
  const index = table.header.indexOf(columnName);
  if (index < 0) throw new Error(`The sheet has no column ${columnName}.`);
  return table.row[index] ?? "";
}

/** True when any cell of any sheet contains the text. */
export function anySheetCellContains(file: ReadXlsx, text: string): boolean {
  return file.sheets.some((sheet) =>
    sheet.rows.some((row) => row.some((cell) => cell.includes(text))),
  );
}
