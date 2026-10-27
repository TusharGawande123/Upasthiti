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
export async function openKioskWithCard(
  serial: string,
  pairingCode: string,
  viewport: { width: number; height: number } = { width: 1280, height: 800 },
  // By default the "device" taps "I'm ready" as soon as that button shows, like a worker would;
  // a test of the get-ready screen itself passes `tapReady: false`.
  options: { tapReady?: boolean } = {},
) {
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
    viewport,
  });
  const device = await context.newPage();
  if (options.tapReady !== false) {
    await device.addLocatorHandler(device.getByRole("button", { name: /I'm ready/ }), (button) =>
      button.click(),
    );
  }
  await device.goto(`/attendance?code=${pairingCode}`);
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

// --- Face enrolment (M3) --------------------------------------------------------------------------

/** The consent text names the privacy contact and the company address, so both must be set. */
export async function setPrivacySettings(api: Api): Promise<void> {
  await api.put("/settings", {
    values: {
      privacy_contact: "E2E Privacy Officer, privacy@example.invalid",
      company_address: "Plot 1, MIDC Waluj, Chhatrapati Sambhajinagar",
    },
    reason: "End-to-end test set-up",
  });
}

/** A permanent employee (punches by face). Returns the id for the employee page. */
export async function makePermanentEmployee(
  api: Api,
  plant: TestPlant,
  employeeCode: string,
  fullName: string,
): Promise<{ id: string }> {
  const staff = await api.get<Array<{ id: string; name: string }>>(
    `/plants/${plant.id}/categories`,
  );
  const category = staff.find((item) => item.name === "Staff");
  if (!category) throw new Error("A new plant should have the category Staff.");
  return api.post<{ id: string }>("/employees", {
    employee_code: employeeCode,
    full_name: fullName,
    type: "permanent",
    plant_id: plant.id,
    category_id: category.id,
    shift_id: plant.shiftId,
    ot_rate_per_hour: "150.00",
    joined_on: new Date().toISOString().slice(0, 10),
  });
}

/**
 * Starts a separate Chromium whose camera plays a clip of made-up person `person` holding the
 * five enrolment poses in turn (3 s each, repeating), and logs in as `login`. Returns the page;
 * call `close()` at the end of the test (it also deletes the clip).
 */
export async function openAdminWithFaceCamera(
  person: number,
  login: string,
  viewport: { width: number; height: number } = { width: 1280, height: 800 },
) {
  mkdirSync(TMP_FOLDER, { recursive: true });
  const clip = `${TMP_FOLDER}/face-${person}-${Date.now()}.y4m`;
  execFileSync("uv", ["run", "python", "-m", "app.scripts.e2e_face_video", String(person), clip], {
    cwd: BACKEND_FOLDER,
    env: { ...process.env, ...BACKEND_ENV },
    stdio: "pipe",
  });
  const browser = await chromium.launch({
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      `--use-file-for-fake-video-capture=${clip}`,
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  const context = await browser.newContext({
    baseURL: FRONTEND_URL,
    permissions: ["camera"],
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
    viewport,
  });
  const page = await context.newPage();
  await logIn(page, login);
  await expect(page.getByRole("heading", { name: /Welcome/ })).toBeVisible();
  const close = async () => {
    await browser.close();
    rmSync(clip, { force: true });
  };
  return { page, close };
}

type Pose = "straight" | "left" | "right" | "up" | "down";

/** Which pose the fake clip shows right now, read from the grey marks in its top-left corner. */
async function poseShownByCamera(page: Page): Promise<Pose | null> {
  return page.evaluate(() => {
    const video = document.querySelector("video");
    if (!video || video.videoWidth === 0) return null;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(video, 0, 0);
    // Squares 2 and 4 of the fake engine's marks: head turn (128 = straight, +2 per degree) and
    // chin (150 = straight, +2 per degree). The grey may shift a little, so the limits are wide.
    const grey = (index: number) => context.getImageData(index * 16 + 8, 8, 1, 1).data[0] ?? 0;
    const yaw = (grey(1) - 128) / 2;
    const pitch = (grey(3) - 150) / 2;
    if (yaw > 10) return "left";
    if (yaw < -10) return "right";
    if (pitch > 10) return "up";
    if (pitch < -10) return "down";
    return Math.abs(yaw) < 6 && Math.abs(pitch) < 6 ? "straight" : null;
  });
}

/** Waits until the clip shows `pose` (twice in a row, so it is not about to change), then taps. */
export async function takeShotWhenCameraShows(page: Page, pose: Pose): Promise<void> {
  await expect(async () => {
    expect(await poseShownByCamera(page)).toBe(pose);
    await page.waitForTimeout(400);
    expect(await poseShownByCamera(page)).toBe(pose);
  }).toPass({ timeout: 30_000, intervals: [200] });
  await page.getByRole("button", { name: "Take shot" }).click();
}

// --- The gate with a painted face (M3 face punch) ----------------------------------------------------
//
// The fake face engine (FACE_ENGINE=fake) reads four grey squares in the top-left corner of each
// picture: which person, the head turn, a pretend problem and the chin (backend/app/face/
// fake_engine.py). Here the browser paints those squares itself, so a test can "turn the head" at
// any moment by changing one number: no clip and no real face. Person 14 looks equally like
// persons 1 and 2 (the server cannot be sure and asks for the employee code); 9 is a stranger.

const ENROL_POSES = {
  straight: { yaw: 0, pitch: 0 },
  left: { yaw: 20, pitch: 0 },
  right: { yaw: -20, pitch: 0 },
  up: { yaw: 0, pitch: 20 },
  down: { yaw: 0, pitch: -20 },
} as const;

/** Enrols a made-up face for an employee through the API: consent, five shots, finish. */
export async function enrolFaceThroughApi(
  page: Page,
  api: Api,
  employeeId: string,
  person: number,
): Promise<void> {
  await api.post(`/employees/${employeeId}/face/consent`, {
    text_version: "face-consent-v1",
    language: "en",
    choice: "agreed",
  });
  const session = await api.post<{ session_id: string }>(
    `/employees/${employeeId}/face/enrolment-sessions`,
  );
  for (const [pose, { yaw, pitch }] of Object.entries(ENROL_POSES)) {
    const imageJpeg = await page.evaluate(
      ({ person, yaw, pitch }) => {
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 480;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("No canvas");
        context.fillStyle = "rgb(150,150,150)";
        context.fillRect(0, 0, 640, 480);
        [16 * person + 8, 128 + 2 * yaw, 8, 150 + 2 * pitch].forEach((grey, index) => {
          const value = Math.round(grey);
          context.fillStyle = `rgb(${value},${value},${value})`;
          context.fillRect(index * 16, 0, 16, 16);
        });
        return canvas.toDataURL("image/jpeg", 0.9).split(",")[1] ?? "";
      },
      { person, yaw, pitch },
    );
    const shot = await api.post<{ accepted: boolean }>(
      `/face/enrolment-sessions/${session.session_id}/shots`,
      { pose, image_jpeg: imageJpeg },
    );
    expect(shot.accepted, `the ${pose} shot of person ${person}`).toBe(true);
  }
  // The same made-up face is enrolled again in other specs: the duplicate check would stop it.
  await api.post(`/face/enrolment-sessions/${session.session_id}/finish`, {
    duplicate_override_reason: "End-to-end test: the same made-up face is used in several specs",
  });
}

/**
 * A gate device (a new browser window) whose camera shows made-up person `person`, paired with
 * the code. MediaPipe is blocked, so the gate uses its timed capture (frontal at once, the turn
 * picture after 1.5 s, frontal again after 3 s). Change the head with `setHead`.
 */
export async function openGateWithPaintedFace(
  browser: Browser,
  pairingCode: string,
  person: number,
  viewport: { width: number; height: number } = { width: 1280, height: 800 },
) {
  const context = await browser.newContext({
    baseURL: FRONTEND_URL,
    geolocation: INSIDE,
    permissions: ["geolocation"],
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
    viewport,
  });
  await context.route("**/models/face_landmarker.task", (route) => route.abort());
  await context.addInitScript(
    ({ person }) => {
      const head = { person, yaw: 0, pitch: 0 };
      (window as unknown as { __head: typeof head }).__head = head;
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 480;
      const context = canvas.getContext("2d");
      const paint = () => {
        if (!context) return;
        context.fillStyle = "rgb(150,150,150)";
        context.fillRect(0, 0, 640, 480);
        [16 * head.person + 8, 128 + 2 * head.yaw, 8, 150 + 2 * head.pitch].forEach(
          (grey, index) => {
            const value = Math.round(grey);
            context.fillStyle = `rgb(${value},${value},${value})`;
            context.fillRect(index * 16, 0, 16, 16);
          },
        );
      };
      paint();
      setInterval(paint, 50);
      navigator.mediaDevices.getUserMedia = async () => canvas.captureStream(20);
    },
    { person },
  );
  const device = await context.newPage();
  await device.goto(`/attendance?code=${pairingCode}`);
  await device.getByRole("button", { name: "Pair this device" }).click();
  /** Turns the head: positive degrees are to the person's own left. */
  const setHead = (yaw: number) =>
    device.evaluate((degrees) => {
      (window as unknown as { __head: { yaw: number } }).__head.yaw = degrees;
    }, yaw);
  return { device, setHead, close: () => context.close() };
}

/**
 * Taps "Punch with face" and does what the gate asks: waits for the arrow, turns the head that
 * way, then looks straight again. The answer (or the code pad) is for the test to look at.
 */
export async function punchWithFace(
  device: Page,
  setHead: (yaw: number) => Promise<void>,
): Promise<void> {
  await setHead(0);
  await device.getByRole("button", { name: /Punch with face/ }).click();
  const asked = device.getByText(/^Turn your head to your/).first();
  await expect(asked).toBeVisible({ timeout: 15_000 });
  const toTheLeft = await device.getByText("LEFT", { exact: true }).isVisible();
  await setHead(toTheLeft ? 25 : -25);
  await expect(device.getByText("Now look straight again.")).toBeVisible({ timeout: 10_000 });
  await setHead(0);
}
