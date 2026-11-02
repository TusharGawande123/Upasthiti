// M4b phone attendance in a real browser (S-46, AC-57): a Pixel 7 sized Chromium with a painted
// camera (a made-up face, no real person), a fixed location and a virtual authenticator. One
// employee of a DEMO plant sets a password by face check, accepts the notice, punches IN with the
// face, adds a passkey and signs in again with it. The pages are also measured at 360 and 768 px.
// Plants and people are made through the admin API; the backend runs with FACE_ENGINE=fake.
import { type CDPSession, expect, type Page, test } from "@playwright/test";
import { FRONTEND_URL } from "../backend-env";
import {
  adminApi,
  enrolFaceThroughApi,
  INSIDE,
  logIn,
  makePermanentEmployee,
  makePlant,
  SUPER_ADMIN_LOGIN,
  setPrivacySettings,
} from "./helpers";

test.describe.configure({ mode: "serial" });

const EMPLOYEE = { code: "PHN-101", name: "Sunita Phone", person: 3 };
const PASSWORD = "Phone-Pass-2026";

let employeeId = "";

/** Paints the camera: a made-up person whose head the page turns when the screen asks for it. */
async function paintCamera(page: Page, person: number) {
  await page.context().route("**/models/face_landmarker.task", (route) => route.abort());
  await page.addInitScript(
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
      // Turn the head the moment the screen asks, and straighten it when the screen says so.
      new MutationObserver(() => {
        // biome-ignore lint/performance/useDomNodeTextContent: only the visible text counts (hidden hints do not).
        const text = document.body?.innerText ?? "";
        if (/now look straight again/i.test(text)) head.yaw = 0;
        else if (/turn your head to your/i.test(text)) head.yaw = /LEFT/.test(text) ? 25 : -25;
      }).observe(document, { subtree: true, childList: true, characterData: true });
    },
    { person },
  );
}

/**
 * A person who sees "Try again" taps it: the painted camera is a video stream with its own delay,
 * and on a busy machine the pictures can still show the old head (same as the gate's e2e helper,
 * which also retries at most twice). Anything else is for the test to judge.
 */
async function tapTryAgainWhenAsked(page: Page) {
  await page.bringToFront();
  await page.addLocatorHandler(
    page.getByRole("button", { name: "Try again" }),
    (button) => button.click(),
    { times: 3 },
  );
}

/** A virtual platform authenticator (the phone's screen lock) that always says yes. */
async function addVirtualAuthenticator(page: Page): Promise<CDPSession> {
  const session = await page.context().newCDPSession(page);
  await session.send("WebAuthn.enable");
  await session.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return session;
}

async function noSidewaysScroll(page: Page, where: string) {
  const widths = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth,
    screen: document.documentElement.clientWidth,
  }));
  expect(
    widths.page,
    `${where}: ${widths.page}px on a ${widths.screen}px screen`,
  ).toBeLessThanOrEqual(widths.screen);
}

test.use({
  geolocation: INSIDE,
  permissions: ["geolocation", "camera"],
  locale: "en-IN",
  timezoneId: "Asia/Kolkata",
  baseURL: FRONTEND_URL,
});

test("set-up: a DEMO plant, an enrolled face and phone punching switched on", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  // The admin works in a laptop window, as in real life.
  const adminContext = await browser.newContext({ baseURL: FRONTEND_URL });
  const admin = await adminContext.newPage();
  try {
    await logIn(admin, SUPER_ADMIN_LOGIN);
    await expect(admin.getByRole("heading", { name: /Welcome/ })).toBeVisible();
    const api = adminApi(admin);
    const plant = await makePlant(api, "DEMOPH");
    await setPrivacySettings(api);
    const made = await makePermanentEmployee(api, plant, EMPLOYEE.code, EMPLOYEE.name);
    employeeId = made.id;
    await enrolFaceThroughApi(admin, api, employeeId, EMPLOYEE.person);
    await api.put(`/employees/${employeeId}/phone/access`, {
      phone_punch_enabled: true,
      reason: "End-to-end test of phone punching",
    });
  } finally {
    await adminContext.close();
  }
});

test("a phone employee sets a password by face, accepts the notice and punches IN with the face", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await paintCamera(page, EMPLOYEE.person);
  await tapTryAgainWhenAsked(page);

  // Sign in is not possible yet: no password. "First time" leads to the face check.
  await page.goto("/phone/login");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await noSidewaysScroll(page, "phone sign in 412px");
  await page.getByRole("link", { name: "First time or forgot your password?" }).click();
  await page.getByRole("button", { name: /Check my face/ }).click();
  await page.getByLabel("Employee code").fill(EMPLOYEE.code);
  await page.getByRole("button", { name: "Start camera" }).click();

  // The head turn runs by itself (the painted head follows the screen); then the password step.
  await expect(page.getByText("Check passed, Sunita")).toBeVisible({ timeout: 60_000 });
  await page.getByLabel("New password").fill(PASSWORD);
  await page.getByLabel("Type it again").fill(PASSWORD);
  await page.getByRole("button", { name: "Save and sign in" }).click();

  // The notice comes first; punching is blocked until "I agree".
  await expect(page.getByRole("heading", { name: "Phone punching notice" })).toBeVisible();
  await noSidewaysScroll(page, "phone notice");
  await page.getByRole("button", { name: "I agree" }).click();
  await expect(page.getByText("Hello, Sunita")).toBeVisible();
  await expect(page.getByText("Location ready")).toBeVisible();

  await page.getByRole("link", { name: "Punch with face" }).click();
  await expect(page.getByText("IN", { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(`Plant DEMOPH`)).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByText(/IN at \d\d:\d\d/)).toBeVisible();
  await expect(page.getByText("Phone", { exact: true }).first()).toBeVisible();
});

test("the employee adds a passkey and signs in with it after signing out", async ({ page }) => {
  test.setTimeout(120_000);
  await paintCamera(page, EMPLOYEE.person);
  await addVirtualAuthenticator(page);

  // Password sign in (the previous test's session lives in another browser context).
  await page.goto("/phone/login");
  await page.getByLabel("Employee code").fill(EMPLOYEE.code);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("Hello, Sunita")).toBeVisible();

  await page.getByRole("link", { name: "Sign in faster with a passkey" }).click();
  await page.getByRole("button", { name: "Add a passkey on this phone" }).click();
  await expect(page.getByText("Passkey added")).toBeVisible();
  await expect(page.getByText("Your passkeys: 1 of 3")).toBeVisible();

  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

  await page.getByLabel("Employee code").fill(EMPLOYEE.code);
  await page.getByRole("button", { name: "Sign in with passkey" }).click();
  await expect(page.getByText("Hello, Sunita")).toBeVisible();
});

test("the phone pages fit a 360 px phone and a 768 px tablet", async ({ page }) => {
  test.setTimeout(120_000);
  await paintCamera(page, EMPLOYEE.person);
  await page.goto("/phone/login");
  await page.getByLabel("Employee code").fill(EMPLOYEE.code);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("Hello, Sunita")).toBeVisible();

  for (const [label, size] of [
    ["360", { width: 360, height: 700 }],
    ["768", { width: 768, height: 1024 }],
  ] as const) {
    await page.setViewportSize(size);
    for (const path of ["/phone", "/phone/attendance", "/phone/passkey", "/phone/notice"]) {
      await page.goto(path);
      await expect(page.getByRole("heading").first()).toBeVisible();
      await noSidewaysScroll(page, `${label} px ${path}`);
    }
  }
});

// AC-52 (F-74): the phone pages link the manifest of /phone and register no service worker.
test("the phone pages link their own manifest and register no service worker", async ({ page }) => {
  await page.goto("/phone/login", { waitUntil: "networkidle" });
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/phone.webmanifest");
  const manifest = await (await page.request.get("/phone.webmanifest")).json();
  expect(manifest.scope).toBe("/phone");
  expect(manifest.display).toBe("standalone");
  const registrations = await page.evaluate(async () =>
    (await navigator.serviceWorker.getRegistrations()).map((entry) => entry.scope),
  );
  expect(registrations.filter((scope) => scope.includes("/phone"))).toEqual([]);
});
