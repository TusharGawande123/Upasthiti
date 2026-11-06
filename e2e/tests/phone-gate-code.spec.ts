// M4b gate-code punch in a real browser (AC-57): a temporary worker signs in on /phone (Pixel 7
// sized Chromium), opens "Scan the phone code at the gate" and scans the CURRENT changing code of a
// paired attendance device. The camera is painted: the page's camera is a canvas showing the QR
// picture (the SVG the server sent to the gate). A tampered code is refused with the plain text;
// the real code is accepted as IN. The plant, worker and device are made through the admin API.
import { execFileSync } from "node:child_process";
import { expect, type Page, test } from "@playwright/test";
import { BACKEND_ENV, BACKEND_FOLDER, FRONTEND_URL } from "../backend-env";
import {
  adminApi,
  INSIDE,
  logIn,
  makeKioskCode,
  makePlant,
  makeWorkerWithCard,
  openKioskDevice,
  SUPER_ADMIN_LOGIN,
  setPrivacySettings,
} from "./helpers";

test.describe.configure({ mode: "serial" });

const WORKER = { code: "GC-201", name: "Ganesh Temp" };
const PASSWORD = "Gate-Code-Pass-2026";

let cardSerial = "";
let pairingCode = "";

test.use({
  geolocation: INSIDE,
  permissions: ["geolocation", "camera"],
  locale: "en-IN",
  timezoneId: "Asia/Kolkata",
  baseURL: FRONTEND_URL,
});

/** The signed text of the card, made with the test signing key (the same as a printed card). */
function cardText(serial: string): string {
  const code = `from app.core.config import get_settings; from app.modules.qr_cards.payload import build_payload; print(build_payload(get_settings(), "${serial}"))`;
  return execFileSync("uv", ["run", "python", "-c", code], {
    cwd: BACKEND_FOLDER,
    env: { ...process.env, ...BACKEND_ENV },
    stdio: "pipe",
  })
    .toString()
    .trim();
}

/**
 * Paints the camera with whatever QR picture `window.__qrSvg` holds (white page, QR in the middle).
 * The test updates the picture whenever the attendance device shows a new code.
 */
async function paintCameraWithQr(page: Page) {
  await page.addInitScript(() => {
    const holder = window as unknown as { __qrSvg?: string };
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 640;
    const context = canvas.getContext("2d");
    let shown = "";
    let picture: HTMLImageElement | null = null;
    const paint = () => {
      if (!context) return;
      if (holder.__qrSvg && holder.__qrSvg !== shown) {
        shown = holder.__qrSvg;
        const image = new Image();
        image.onload = () => {
          picture = image;
        };
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(shown)}`;
      }
      context.fillStyle = "white";
      context.fillRect(0, 0, 640, 640);
      if (picture) context.drawImage(picture, 80, 80, 480, 480);
    };
    paint();
    setInterval(paint, 50);
    navigator.mediaDevices.getUserMedia = async () => canvas.captureStream(20);
  });
}

test("set-up: a plant, a temporary worker with phone punching on and a password", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const adminContext = await browser.newContext({ baseURL: FRONTEND_URL });
  const admin = await adminContext.newPage();
  try {
    await logIn(admin, SUPER_ADMIN_LOGIN);
    await expect(admin.getByRole("heading", { name: /Welcome/ })).toBeVisible();
    const api = adminApi(admin);
    const plant = await makePlant(api, "DEMOGC");
    await setPrivacySettings(api); // the phone notice needs the company address and contact
    const worker = await makeWorkerWithCard(api, plant, WORKER.code, WORKER.name);
    cardSerial = worker.serial;
    const list = await api.get<{ items: Array<{ id: string; employee_code: string }> }>(
      `/employees?q=${WORKER.code}`,
    );
    const employee = list.items.find((item) => item.employee_code === WORKER.code);
    if (!employee) throw new Error("The new worker should be in the list.");
    await api.put(`/employees/${employee.id}/phone/access`, {
      phone_punch_enabled: true,
      reason: "End-to-end test of the gate-code punch",
    });
    pairingCode = await makeKioskCode(api, plant, "Gate code gate");
  } finally {
    await adminContext.close();
  }

  // The first password comes after a proof with the ID card (the card text is sent as the
  // phone does; the screen test of the card scan is in the unit tests).
  const phoneContext = await browser.newContext({
    baseURL: FRONTEND_URL,
    geolocation: INSIDE,
    permissions: ["geolocation"],
  });
  try {
    const headers = { Origin: FRONTEND_URL };
    const proof = await phoneContext.request.post("/api/v1/phone/proof/card", {
      headers,
      data: {
        qr_payload: cardText(cardSerial),
        location: {
          lat: INSIDE.latitude,
          lon: INSIDE.longitude,
          accuracy_m: INSIDE.accuracy,
          age_s: 0,
        },
      },
    });
    expect(proof.ok(), `card proof: ${proof.status()} ${await proof.text()}`).toBe(true);
    const { proof_token } = (await proof.json()) as { proof_token: string };
    const saved = await phoneContext.request.post("/api/v1/phone/password", {
      headers,
      data: { proof_token, new_password: PASSWORD },
    });
    expect(saved.ok(), `set password: ${saved.status()}`).toBe(true);
  } finally {
    await phoneContext.close();
  }
});

test("the worker scans the changing gate code: a tampered code is refused, the real one is IN", async ({
  browser,
  page,
}) => {
  test.setTimeout(180_000);

  // The attendance device (a laptop window) is paired; it shows and refreshes the phone code.
  const { context: gateContext, device } = await openKioskDevice(browser, { geolocation: INSIDE });
  try {
    // The gate has a plain grey camera (it reads no card in this test) so that its idle screen,
    // which shows the phone code, appears.
    await device.addInitScript(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 320;
      canvas.height = 240;
      const context = canvas.getContext("2d");
      setInterval(() => {
        if (!context) return;
        context.fillStyle = "rgb(150,150,150)";
        context.fillRect(0, 0, 320, 240);
      }, 100);
      navigator.mediaDevices.getUserMedia = async () => canvas.captureStream(10);
    });
    let currentSvg = "";
    let currentText = "";
    const push = async () => {
      if (!currentSvg) return;
      await page.evaluate((svg) => {
        (window as unknown as { __qrSvg?: string }).__qrSvg = svg;
      }, currentSvg);
    };
    device.on("response", async (response) => {
      if (!response.url().endsWith("/api/v1/kiosk/gate-code")) return;
      try {
        const answer = (await response.json()) as { code_text: string | null; svg: string | null };
        if (!answer.code_text || !answer.svg) return;
        currentText = answer.code_text;
        currentSvg = answer.svg;
        await push();
      } catch {
        // The page was closed while the answer was read: nothing to do.
      }
    });
    const firstCode = device.waitForResponse(
      async (response) =>
        response.url().endsWith("/api/v1/kiosk/gate-code") &&
        (await response.json().catch(() => ({ code_text: null }))).code_text !== null,
    );
    await device.goto(`/attendance?code=${pairingCode}`);
    await device.getByRole("button", { name: "Pair this device" }).click();
    await firstCode;
    expect(currentText).toMatch(/^UPG1\./);

    // Sign in on the phone with the password; accept the notice.
    await paintCameraWithQr(page);
    await page.goto("/phone/login");
    await page.getByLabel("Employee code").fill(WORKER.code);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Phone punching notice" })).toBeVisible();
    await page.getByRole("button", { name: "I agree" }).click();
    await expect(page.getByText("Hello, Ganesh")).toBeVisible();
    await expect(page.getByText("Location ready")).toBeVisible();
    await push();

    // The phone sends the code unchanged, except the first time: one letter of the signature is
    // changed on the way (the tampered code).
    let tampered = false;
    await page.route("**/api/v1/phone/punch/gate-code", async (route) => {
      if (tampered) return route.continue();
      tampered = true;
      const body = route.request().postDataJSON() as { gate_code: string };
      const last = body.gate_code.slice(-1);
      body.gate_code = body.gate_code.slice(0, -1) + (last === "A" ? "B" : "A");
      return route.continue({ postData: JSON.stringify(body) });
    });

    // First try: tampered code, refused with the plain text, nothing recorded.
    await page.getByRole("link", { name: "Scan the phone code at the gate" }).click();
    await page.getByRole("button", { name: "I'm ready" }).click();
    await expect(page.getByText("NOT ACCEPTED")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("This phone code is not valid.")).toBeVisible();
    await expect(page.getByText("Please visit the plant office.")).toBeVisible();

    // Second try: the current real code is accepted as IN.
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByText("Hello, Ganesh")).toBeVisible();
    await push();
    await page.getByRole("link", { name: "Scan the phone code at the gate" }).click();
    await page.getByRole("button", { name: "I'm ready" }).click();
    await expect(page.getByText("IN", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Plant DEMOGC")).toBeVisible();
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByText(/IN at \d\d:\d\d/)).toBeVisible();
  } finally {
    await gateContext.close();
  }
});
