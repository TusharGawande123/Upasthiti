// M3 face punch at the gate in a real browser (spec AC-13 to AC-16, design gate A). The backend
// runs with FACE_ENGINE=fake; the gate's camera is painted by the test (see
// openGateWithPaintedFace), so "turning the head" is one number: no real face is used. Plants,
// people and kiosks are made through the admin API; the enrolment screens have their own spec.
import { mkdirSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { TMP_FOLDER } from "../backend-env";
import {
  adminApi,
  enrolFaceThroughApi,
  expectNoSeriousAccessibilityIssues,
  logIn,
  makeKioskCode,
  makePermanentEmployee,
  makePlant,
  openGateWithPaintedFace,
  punchWithFace,
  SUPER_ADMIN_LOGIN,
  setPrivacySettings,
  type TestPlant,
} from "./helpers";

// The tests share one database: this file makes its own plants and runs in order.
test.describe.configure({ mode: "serial" });

let gatePlant: TestPlant;
let quietPlant: TestPlant; // nobody enrolled here: the gate has no face button
let api: ReturnType<typeof adminApi>;

// Made-up faces: 1 and 2 are enrolled, 14 looks like both (the server cannot be sure), 9 is nobody.
const ASHA = { code: "FG-101", name: "Asha Kale", person: 1 };
const BHAVNA = { code: "FG-102", name: "Bhavna Rane", person: 2 };
const TWINS_FACE = 14;
const STRANGER_FACE = 9;

async function signIn(page: Page) {
  await logIn(page, SUPER_ADMIN_LOGIN);
  await expect(page.getByRole("heading", { name: /Welcome/ })).toBeVisible();
  api = adminApi(page);
}

test("set-up: a plant with two enrolled faces and a plant with none", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page);
  gatePlant = await makePlant(api, "FG1");
  quietPlant = await makePlant(api, "FG2");
  await setPrivacySettings(api);
  for (const employee of [ASHA, BHAVNA]) {
    const made = await makePermanentEmployee(api, gatePlant, employee.code, employee.name);
    await enrolFaceThroughApi(page, api, made.id, employee.person);
  }
  await makePermanentEmployee(api, quietPlant, "FG-201", "Chetan Pawar");
});

test("a face punch checks the worker IN, then says ALREADY IN", async ({ page, browser }) => {
  test.setTimeout(120_000);
  await signIn(page);
  const code = await makeKioskCode(api, gatePlant, "Face gate");
  const { device, setHead, close } = await openGateWithPaintedFace(browser, code, ASHA.person);
  try {
    await expect(device.getByRole("button", { name: /Punch with face/ })).toBeEnabled();
    await expectNoSeriousAccessibilityIssues(device);

    // The gate takes the turn picture 1.5 s after the arrow shows: turn the head at once.
    await setHead(0);
    await device.getByRole("button", { name: /Punch with face/ }).click();
    await expect(device.getByText(/^Turn your head to your/).first()).toBeVisible({
      timeout: 15_000,
    });
    const toTheLeft = await device.getByText("LEFT", { exact: true }).isVisible();
    await setHead(toTheLeft ? 25 : -25);
    await expect(device.getByText("Now look straight again.")).toBeVisible({ timeout: 10_000 });
    await setHead(0);

    await expect(device.getByText("IN", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(device.getByText(ASHA.name)).toBeVisible();
    await expect(device.getByText(`Employee code ${ASHA.code} · Checked in`)).toBeVisible();
    await expectNoSeriousAccessibilityIssues(device);

    // Back to scanning by itself; the same face again is already IN (cool-down).
    await expect(device.getByText("Show your ID card to the camera")).toBeVisible({
      timeout: 15_000,
    });
    await punchWithFace(device, setHead);
    await expect(device.getByText("ALREADY IN", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(device.getByText(ASHA.name)).toBeVisible();
  } finally {
    await close();
  }
});

test("when the server is unsure, the worker types the employee code and is accepted", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  await signIn(page);
  const code = await makeKioskCode(api, gatePlant, "Face gate 2");
  const { device, setHead, close } = await openGateWithPaintedFace(browser, code, TWINS_FACE);
  try {
    await punchWithFace(device, setHead);

    await expect(device.getByRole("heading", { name: "Type your employee code" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(device.getByText("We could not be sure it is you.")).toBeVisible();
    // The name is never shown on the code pad.
    await expect(device.getByText(BHAVNA.name)).toBeHidden();
    await expectNoSeriousAccessibilityIssues(device);

    // Typed with the pad: letters on the second page, then digits.
    await device.getByRole("button", { name: "ABC" }).click();
    for (const key of ["F", "G", "-"]) {
      await device.getByRole("button", { name: key, exact: true }).click();
    }
    await device.getByRole("button", { name: "123" }).click();
    for (const key of ["1", "0", "2"]) {
      await device.getByRole("button", { name: key, exact: true }).click();
    }
    await expect(device.getByLabel("Employee code typed so far")).toHaveText(BHAVNA.code);
    await expectNoSeriousAccessibilityIssues(device);
    await device.getByRole("button", { name: "OK" }).click();

    await expect(device.getByText("IN", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(device.getByText(BHAVNA.name)).toBeVisible();
  } finally {
    await close();
  }
});

test("a wrong code twice is NOT ACCEPTED, and the second try keeps the typed code", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  await signIn(page);
  const code = await makeKioskCode(api, gatePlant, "Face gate 3");
  const { device, setHead, close } = await openGateWithPaintedFace(browser, code, TWINS_FACE);
  try {
    await punchWithFace(device, setHead);
    await expect(device.getByRole("heading", { name: "Type your employee code" })).toBeVisible({
      timeout: 15_000,
    });

    // The code of someone else: the server says it does not match this face, with one try left.
    await device.keyboard.type("FG-201");
    await device.getByRole("button", { name: "OK" }).click();
    await expect(device.getByText(/That code does not match your face/)).toBeVisible({
      timeout: 15_000,
    });
    await expect(device.getByText("1 try left")).toBeVisible();
    await expect(device.getByLabel("Employee code typed so far")).toHaveText("FG-201");

    await device.getByRole("button", { name: "OK" }).click();
    await expect(device.getByText("NOT ACCEPTED")).toBeVisible({ timeout: 15_000 });
    await expect(device.getByText("We could not recognise you.")).toBeVisible();
    await expect(device.getByText("FACE_NOT_RECOGNISED")).toBeVisible();
    await expect(device.getByText(ASHA.name)).toBeHidden();
    await expect(device.getByText(BHAVNA.name)).toBeHidden();
    await expectNoSeriousAccessibilityIssues(device);
  } finally {
    await close();
  }
});

test("a head that does not turn is NOT ACCEPTED, and Try again starts the guidance again", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  await signIn(page);
  const code = await makeKioskCode(api, gatePlant, "Face gate 5");
  const { device, setHead, close } = await openGateWithPaintedFace(browser, code, ASHA.person);
  try {
    await setHead(0);
    await device.getByRole("button", { name: /Punch with face/ }).click();
    await expect(device.getByText(/^Turn your head to your/).first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(device.getByRole("button", { name: "Cancel" })).toBeVisible();
    await expectNoSeriousAccessibilityIssues(device); // the head never turns: the punch is refused

    await expect(device.getByText("NOT ACCEPTED")).toBeVisible({ timeout: 15_000 });
    await expect(
      device.getByText("Please turn your head as the arrow shows, then look straight."),
    ).toBeVisible();
    await expect(device.getByText("LIVENESS_FAILED")).toBeVisible();
    await expect(device.getByText(ASHA.name)).toBeHidden();
    await expectNoSeriousAccessibilityIssues(device);

    await device.getByRole("button", { name: "Try again" }).click();
    await expect(device.getByRole("button", { name: "Cancel" })).toBeVisible();
    await device.getByRole("button", { name: "Cancel" }).click();
    await expect(device.getByText("Show your ID card to the camera")).toBeVisible();
  } finally {
    await close();
  }
});

test("a stranger is NOT ACCEPTED", async ({ page, browser }) => {
  test.setTimeout(120_000);
  await signIn(page);
  const code = await makeKioskCode(api, gatePlant, "Face gate 4");
  const { device, setHead, close } = await openGateWithPaintedFace(browser, code, STRANGER_FACE);
  try {
    await punchWithFace(device, setHead);
    // Nobody looks like this face: no code pad, a clear refusal.
    await expect(device.getByText("NOT ACCEPTED")).toBeVisible({ timeout: 15_000 });
    await expect(device.getByText("We could not recognise you.")).toBeVisible();
  } finally {
    await close();
  }
});

test("the button is hidden at a plant where nobody has a face", async ({ page, browser }) => {
  await signIn(page);
  const code = await makeKioskCode(api, quietPlant, "Quiet gate");
  const { device, close } = await openGateWithPaintedFace(browser, code, 1);
  try {
    await expect(device.getByText("Show your ID card to the camera")).toBeVisible();
    await expect(device.getByRole("button", { name: /Punch with face/ })).toHaveCount(0);
  } finally {
    await close();
  }
});

test("the face screens fit a small phone and a tablet", async ({ page, browser }) => {
  test.setTimeout(180_000);
  await signIn(page);
  mkdirSync(TMP_FOLDER, { recursive: true });
  for (const size of [
    { width: 360, height: 740 },
    { width: 768, height: 1024 },
  ]) {
    const code = await makeKioskCode(api, gatePlant, `Small gate ${size.width}`);
    const { device, setHead, close } = await openGateWithPaintedFace(
      browser,
      code,
      TWINS_FACE,
      size,
    );
    const fits = async (name: string) => {
      expect(
        await device.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
        `${name} at ${size.width} px`,
      ).toBeLessThanOrEqual(0);
      await device.screenshot({ path: `${TMP_FOLDER}/gate-${name}-${size.width}.png` });
    };
    try {
      await expect(device.getByRole("button", { name: /Punch with face/ })).toBeEnabled();
      await fits("idle");
      await setHead(0);
      await device.getByRole("button", { name: /Punch with face/ }).click();
      await expect(device.getByText(/^Turn your head to your/).first()).toBeVisible({
        timeout: 15_000,
      });
      const toTheLeft = await device.getByText("LEFT", { exact: true }).isVisible();
      await setHead(toTheLeft ? 25 : -25);
      await fits("turn");
      await expect(device.getByText("Now look straight again.")).toBeVisible({ timeout: 10_000 });
      await setHead(0);
      await fits("straight");
      await expect(device.getByRole("heading", { name: "Type your employee code" })).toBeVisible({
        timeout: 15_000,
      });
      await fits("code-pad");
      await device.getByRole("button", { name: "ABC" }).click();
      await fits("code-pad-letters");
      await device.keyboard.type("FG-201");
      await device.getByRole("button", { name: "OK" }).click();
      await expect(device.getByText(/That code does not match your face/)).toBeVisible({
        timeout: 15_000,
      });
      await fits("code-wrong");
      await device.getByRole("button", { name: "OK" }).click();
      await expect(device.getByText("NOT ACCEPTED")).toBeVisible({ timeout: 15_000 });
      await fits("rejected");
    } finally {
      await close();
    }
  }
});
