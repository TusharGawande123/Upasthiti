// J-13 (M6 AC-M6-5, AC-M6-8): the live dashboard, the emergency muster, the punctuality page and the
// notifications bell, for the three roles. The plant J13A is NOT a DEMO plant of the throw-away
// database, because DEMO plants never raise alerts (decision 0036). Two temporary workers punch IN
// at a real (browser) attendance device; the numbers on the screen are compared with the rows; the
// 30-second refresh is triggered by moving the browser's clock, not by waiting; the "still inside"
// alert is raised by the same job function the scheduler runs (e2e_run_alerts.py, test-only, with a
// chosen "now" after the shift end) and has to arrive in the bell of the Super Admin, the
// Corporate Head and the Plant Head of that plant.
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { BACKEND_ENV, BACKEND_FOLDER } from "../backend-env";
import {
  adminApi,
  assignPlant,
  CORPORATE_HEAD_LOGIN,
  makeKioskCode,
  makePlant,
  makeWorkerWithCard,
  openKioskWithCard,
  PLANT_HEAD_LOGIN,
  SUPER_ADMIN_LOGIN,
} from "../tests/helpers";
import { isoDate } from "./golden";
import { downloadFile, openAs, type ReadPdf, readBack } from "./journey-helpers";

test.describe.configure({ mode: "serial" });

const NEXT_SCAN = { timeout: 60_000 };

type Live = {
  plants: Array<{ plant: { code: string }; inside_now: number; inside_temporary: number }>;
  totals: { inside_now: number };
};
type Muster = {
  plants: Array<{
    plant: { code: string };
    count: number;
    people: Array<{ employee: { code: string; name: string } }>;
  }>;
};
type Punctuality = { arrivals: number; late_count: number; top_late: Array<{ late_count: number }> };
type Notices = {
  items: Array<{
    kind: string;
    severity: string;
    plant: { code: string } | null;
    params: { count?: number; plant?: string; minutes?: number };
    read: boolean;
    resolved_at: string | null;
  }>;
};

/** The latest date that is not a Sunday and is at least `daysAgo` days in the past. */
function workingDayBefore(daysAgo: number): Date {
  const day = new Date();
  day.setDate(day.getDate() - daysAgo);
  while (day.getDay() === 0) day.setDate(day.getDate() - 1);
  return day;
}

/**
 * A moment after the shift end (19:00) plus the alert wait (60 minutes): today 20:30 Indian time,
 * or one minute from now when that is already later, so the punches are never in the "future".
 */
function momentForStillInsideAlert(): string {
  const now = new Date();
  const eveningToday = new Date(`${isoDate(now)}T20:30:00+05:30`);
  const moment = eveningToday > now ? eveningToday : new Date(now.getTime() + 60_000);
  return moment.toISOString();
}

test("J-13 live numbers equal the rows, the muster lists who is inside, and the still-inside alert reaches the bell", async ({ browser }) => {
  test.setTimeout(420_000);
  const admin = await openAs(browser, SUPER_ADMIN_LOGIN, /Welcome/);
  const api = admin.api;
  const plant = await makePlant(api, "J13A");
  await api.patch(`/plants/${plant.id}`, { attendance_start_date: isoDate(workingDayBefore(10)) });
  await assignPlant(api, PLANT_HEAD_LOGIN, plant.id);
  const first = await makeWorkerWithCard(api, plant, "J13-W1", "Inside One Journey");
  const second = await makeWorkerWithCard(api, plant, "J13-W2", "Inside Two Journey");
  await makeWorkerWithCard(api, plant, "J13-W3", "Never Punched Journey");

  // A permanent person with one corrected day, so the punctuality page has an arrival: IN 07:50 is
  // after the 30 minutes of grace, so the day counts as one late arrival.
  const categories = await api.get<Array<{ id: string; name: string }>>(
    `/plants/${plant.id}/categories`,
  );
  const lateDay = workingDayBefore(2);
  const permanent = await api.post<{ id: string }>("/employees", {
    employee_code: "J13-P1",
    full_name: "Late Punctual Journey",
    type: "permanent",
    plant_id: plant.id,
    category_id: categories.find((category) => category.name === "Staff")?.id,
    shift_id: plant.shiftId,
    joined_on: "2020-01-01",
  });
  await api.post("/regularisations", {
    employee_id: permanent.id,
    attendance_date: isoDate(lateDay),
    kind: "add_in_out",
    in_time: `${isoDate(lateDay)}T07:50:00+05:30`,
    out_time: `${isoDate(lateDay)}T19:05:00+05:30`,
    reason: "Journey arrival for the punctuality page",
  });

  // 1. The first worker punches IN at the attendance device (a real gate in a second browser).
  const firstGate = await openKioskWithCard(
    first.serial,
    await makeKioskCode(api, plant, "J13 gate one"),
  );
  try {
    await expect(firstGate.device.getByText("IN", { exact: true })).toBeVisible(NEXT_SCAN);
    await expect(firstGate.device.getByText("Inside One Journey")).toBeVisible();
  } finally {
    await firstGate.close();
  }

  // 2. The Plant Head opens the dashboard. The browser's clock is controlled, so the 30-second
  //    refresh is moved forward instead of waited for. One person is inside.
  const head = await openAs(browser, PLANT_HEAD_LOGIN, "Welcome, E2E Plant Head");
  try {
    await head.page.clock.install();
    await head.page.goto("/admin");
    await expect(head.page.getByRole("link", { name: /^Inside now, 1\./ })).toBeVisible();

    // 3. The second worker punches IN; the dashboard shows the new number after the refresh.
    const secondGate = await openKioskWithCard(
      second.serial,
      await makeKioskCode(api, plant, "J13 gate two"),
    );
    try {
      await expect(secondGate.device.getByText("IN", { exact: true })).toBeVisible(NEXT_SCAN);
      await expect(secondGate.device.getByText("Inside Two Journey")).toBeVisible();
    } finally {
      await secondGate.close();
    }
    await head.page.clock.fastForward(31_000);
    await expect(head.page.getByRole("link", { name: /^Inside now, 2\./ })).toBeVisible();
    await expect(head.page.getByText("Of which temporary: 2")).toBeVisible();

    // 4. The numbers equal the rows: the live numbers, the muster list and the screen agree.
    const live = await head.api.get<Live>("/dashboard/live");
    expect(live.plants.map((item) => item.plant.code)).toEqual(["J13A"]);
    expect(live.plants[0]).toMatchObject({ inside_now: 2, inside_temporary: 2 });
    const muster = await head.api.get<Muster>("/muster");
    expect(muster.plants).toHaveLength(1);
    expect(muster.plants[0]?.count).toBe(2);
    expect(muster.plants[0]?.people.map((item) => item.employee.code).sort()).toEqual([
      "J13-W1",
      "J13-W2",
    ]);

    // 5. The emergency muster screen lists exactly those two, and its PDF holds them too.
    await head.page.goto("/admin/muster");
    await expect(head.page.getByText("Inside One Journey").first()).toBeVisible();
    await expect(head.page.getByText("Inside Two Journey").first()).toBeVisible();
    await expect(head.page.getByText("Never Punched Journey")).toHaveCount(0);
    const musterPdf = readBack<ReadPdf>(
      await downloadFile(head.page, "/muster.pdf", "j13-muster.pdf"),
    );
    const pdfText = musterPdf.text.join(" ");
    expect(pdfText).toContain("J13-W1");
    expect(pdfText).toContain("J13-W2");
    expect(pdfText).not.toContain("J13-W3");

    // 6. The punctuality page shows the one late arrival of the permanent person.
    const from = isoDate(workingDayBefore(5));
    const to = isoDate(new Date());
    const punctuality = await head.api.get<Punctuality>(
      `/insights/punctuality?date_from=${from}&date_to=${to}`,
    );
    expect(punctuality).toMatchObject({ arrivals: 1, late_count: 1 });
    await head.page.goto("/admin/insights/punctuality");
    await expect(head.page.getByRole("heading", { name: "Punctuality" })).toBeVisible();
    await expect(head.page.getByText("Most late arrivals")).toBeVisible();
    await expect(head.page.getByText("Late Punctual Journey")).toBeVisible();

    // 7. Alerts (AC-M6-8): the plant is not a DEMO plant, so the job raises "still inside" once the
    //    shift ended 60 minutes ago. Nobody punched OUT.
    const before = await api.get<Notices>("/notifications?kind=still_inside&page_size=50");
    expect(before.items).toEqual([]);
    execFileSync("uv", ["run", "python", "-m", "app.scripts.e2e_run_alerts", momentForStillInsideAlert()], {
      cwd: BACKEND_FOLDER,
      env: { ...process.env, ...BACKEND_ENV },
      stdio: "pipe",
    });
    const alerts = await api.get<Notices>("/notifications?kind=still_inside&page_size=50");
    expect(alerts.items).toHaveLength(1);
    expect(alerts.items[0]).toMatchObject({
      severity: "urgent",
      plant: { code: "J13A" },
      params: { count: 2, plant: "J13A", minutes: 60 },
      read: false,
      resolved_at: null,
    });

    // 8. The alert is in the bell of the Plant Head (own plant) and of the Super Admin.
    await head.page.clock.resume();
    await head.page.goto("/admin");
    await head.page.getByRole("button", { name: /^Notifications, \d+ unread$/ }).click();
    await expect(head.page.getByText(/2 people are still inside J13A/)).toBeVisible();
  } finally {
    await head.close();
  }

  await admin.page.goto("/admin");
  await admin.page.getByRole("button", { name: /^Notifications, \d+ unread$/ }).click();
  await expect(admin.page.getByText(/2 people are still inside J13A/)).toBeVisible();
  await admin.page.getByRole("button", { name: "Mark all as read" }).click();
  await expect(admin.page.getByRole("button", { name: "Notifications, none unread" })).toBeVisible();

  // 9. The Corporate Head sees the same alert in the list of all plants.
  const corporate = await openAs(browser, CORPORATE_HEAD_LOGIN, "Welcome, E2E Corporate Head");
  try {
    const seen = await corporate.api.get<Notices>("/notifications?kind=still_inside&page_size=50");
    expect(seen.items.map((item) => item.plant?.code)).toEqual(["J13A"]);
    const liveForCorporate = await corporate.api.get<Live>("/dashboard/live");
    expect(liveForCorporate.plants.find((item) => item.plant.code === "J13A")?.inside_now).toBe(2);
    await corporate.page.goto("/admin/notifications");
    await expect(corporate.page.getByText(/2 people are still inside J13A/)).toBeVisible();
  } finally {
    await corporate.close();
  }

  await admin.close();
});
