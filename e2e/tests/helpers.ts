// Shared helpers for the end-to-end tests: logging in as the fake users made by e2e_seed, the
// accessibility scan (spec S-17), kiosk devices, admin set-up through the API, and a kiosk whose
// fake camera shows a QR card (M2).
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { type Browser, chromium, expect, type Page } from "@playwright/test";
import { BACKEND_ENV, BACKEND_FOLDER, FRONTEND_URL, TMP_FOLDER } from "../backend-env";

// Fake values from backend/app/scripts/e2e_seed.py (public, test database only).
export const E2E_PASSWORD = "E2e-Test-Password-1";
export const SUPER_ADMIN_LOGIN = "e2e.super";
export const CORPORATE_HEAD_LOGIN = "e2e.corporate";
export const PLANT_HEAD_LOGIN = "e2e.plant";

export async function logIn(page: Page, login: string, password = E2E_PASSWORD) {
  await page.goto("/admin/login");
  await page.getByLabel("Username or email").fill(login);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
}

/** Fails the test when the page has a "serious" or "critical" accessibility problem. */
export async function expectNoSeriousAccessibilityIssues(page: Page) {
  const result = await new AxeBuilder({ page }).analyze();
  const serious = result.violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );
  expect(
    serious.map((violation) => `${violation.id}: ${violation.nodes.length} element(s)`),
  ).toEqual([]);
}

// --- Kiosk devices -------------------------------------------------------------------------------

// The map starts at MIDC Waluj (19.85, 75.2); geofences drawn around the centre cover it.
export const INSIDE = { latitude: 19.85, longitude: 75.2, accuracy: 10 };
export const FAR_AWAY = { latitude: 19.95, longitude: 75.45, accuracy: 10 };

/** The code shown in the admin's dialog, from the accessible name "4 8 2 9 1 3". */
export async function readPairingCode(page: Page): Promise<string> {
  const digits = page.getByRole("img", { name: /^\d \d \d \d \d \d$/ });
  await expect(digits).toBeVisible();
  const label = await digits.getAttribute("aria-label");
  return (label ?? "").replaceAll(" ", "");
}

/** A second browser window acting as the gate device, with a fake GPS position. */
export async function openKioskDevice(
  browser: Browser,
  options: { geolocation?: typeof INSIDE; allowLocation?: boolean },
) {
  const context = await browser.newContext({
    baseURL: FRONTEND_URL,
    geolocation: options.geolocation,
    permissions: options.allowLocation === false ? [] : ["geolocation"],
  });
  return { context, device: await context.newPage() };
}

// --- Admin set-up through the API (fast; the admin screens have their own tests) ----------------

/** Calls /api/v1 with the logged-in admin's session cookie. */
export function adminApi(page: Page) {
  // Writes must come from our own site (CSRF check), like a real browser request.
  const headers = { Origin: FRONTEND_URL };
  async function call<T>(
    method: "get" | "post" | "put" | "patch",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const response = await page.request[method](`/api/v1${path}`, { headers, data: body });
    expect(response.ok(), `${method.toUpperCase()} ${path}: ${response.status()}`).toBe(true);
    return (await response.json()) as T;
  }
  return {
    get: <T>(path: string) => call<T>("get", path),
    post: <T>(path: string, body: unknown = {}) => call<T>("post", path, body),
    put: <T>(path: string, body: unknown) => call<T>("put", path, body),
    patch: <T>(path: string, body: unknown) => call<T>("patch", path, body),
  };
}

type Api = ReturnType<typeof adminApi>;
export type TestPlant = { id: string; code: string; shiftId: string; helperId: string };

/** A plant with a 400 m square geofence around INSIDE, ready for kiosks. */
export async function makePlant(api: Api, code: string): Promise<TestPlant> {
  const plant = await api.post<{ id: string }>("/plants", { name: `Plant ${code}`, code });
  const half = 0.002; // about 200 m in each direction
  const { latitude: lat, longitude: lon } = INSIDE;
  const ring = [
    [lon - half, lat - half],
    [lon + half, lat - half],
    [lon + half, lat + half],
    [lon - half, lat + half],
    [lon - half, lat - half],
  ];
  await api.put(`/plants/${plant.id}/geofence`, {
    shape: "polygon",
    geojson: { type: "Polygon", coordinates: [ring] },
    buffer_m: 25,
  });
  const shifts = await api.get<Array<{ id: string }>>(`/plants/${plant.id}/shifts`);
  const categories = await api.get<Array<{ id: string; name: string }>>(
    `/plants/${plant.id}/categories`,
  );
  const helper = categories.find((category) => category.name === "Helper");
  if (!shifts[0] || !helper) throw new Error("A new plant should have a shift and categories.");
  return { id: plant.id, code, shiftId: shifts[0].id, helperId: helper.id };
}

/** A temporary worker (punches by QR) with a working card. Returns the card. */
export async function makeWorkerWithCard(
  api: Api,
  plant: TestPlant,
  employeeCode: string,
  fullName: string,
): Promise<{ cardId: string; serial: string }> {
  const employee = await api.post<{ id: string }>("/employees", {
    employee_code: employeeCode,
    full_name: fullName,
    type: "temporary",
    plant_id: plant.id,
    category_id: plant.helperId,
    shift_id: plant.shiftId,
    hourly_rate: "85.00",
    joined_on: new Date().toISOString().slice(0, 10),
  });
  const issued = await api.post<{ card: { id: string; serial: string } }>(
    `/employees/${employee.id}/qr-cards`,
  );
  return { cardId: issued.card.id, serial: issued.card.serial };
}

/** A new kiosk at the plant; returns its one-time pairing code. */
export async function makeKioskCode(api: Api, plant: TestPlant, name: string): Promise<string> {
  const made = await api.post<{ pairing_code: string }>("/kiosks", { plant_id: plant.id, name });
  return made.pairing_code;
}

// --- A kiosk whose camera shows a card -----------------------------------------------------------

/**
 * Starts a separate Chromium whose camera plays a clip of the card's QR code (about 1.5 s of
 * card, then 20 s of grey, repeating), pairs it as a kiosk with the code, and returns the page
 * on the attendance screen. Call `close()` at the end of the test (it also deletes the clip).
 */
export async function openKioskWithCard(serial: string, pairingCode: string) {
  mkdirSync(TMP_FOLDER, { recursive: true });
  const clip = `${TMP_FOLDER}/card-${serial}-${Date.now()}.y4m`;
  execFileSync("uv", ["run", "python", "-m", "app.scripts.e2e_card_video", serial, clip], {
    cwd: BACKEND_FOLDER,
    env: { ...process.env, ...BACKEND_ENV },
    stdio: "pipe",
  });
  const browser = await chromium.launch({
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream", // allows the camera without a prompt
      `--use-file-for-fake-video-capture=${clip}`,
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  const context = await browser.newContext({
    baseURL: FRONTEND_URL,
    geolocation: INSIDE,
    permissions: ["geolocation", "camera"],
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
    viewport: { width: 1280, height: 800 },
  });
  const device = await context.newPage();
  await device.goto(`/kiosk?code=${pairingCode}`);
  await device.getByRole("button", { name: "Pair this device" }).click();
  const close = async () => {
    await browser.close();
    rmSync(clip, { force: true });
  };
  return { device, close };
}

/** Gives a seeded user (for example the Plant Head) the plant, through the Super Admin's API. */
export async function assignPlant(api: Api, username: string, plantId: string): Promise<void> {
  const users = await api.get<{ items: Array<{ id: string; username: string }> }>(
    "/users?page_size=200",
  );
  const user = users.items.find((item) => item.username === username);
  if (!user) throw new Error(`The user ${username} should exist (see the e2e seed).`);
  await api.patch(`/users/${user.id}`, { plant_id: plantId });
}
