// J-11 (M6 AC-M6-5, AC-M6-6): a Plant Head asks for a correction and the Super Admin decides it on
// the Corrections screen (one approved, one rejected with a reason), the Super Admin corrects many
// people at once after a gate outage (bulk correction), and moves one person to another shift for
// one day (shift swap). The journey ends with a read-back: the day status from the server and the
// "*" mark ("corrected") in the monthly register FILE, opened again with e2e_read_file.
// A full shift counts as Present only when the person stays until the shift end (19:00), so the
// corrections use 07:05 to 19:05. The days are made the way the app really makes them: a correction stores the day and the one
// before and after it (placeholders), and the register recomputes them when it is asked for.
import { expect, test } from "@playwright/test";
import {
  adminApi,
  assignPlant,
  logIn,
  makePlant,
  PLANT_HEAD_LOGIN,
  SUPER_ADMIN_LOGIN,
} from "../tests/helpers";
import { isoDate } from "./golden";
import { downloadFile, openAs, type ReadXlsx, readBack, tryCall } from "./journey-helpers";

test.describe.configure({ mode: "serial" });

type DayAnswer = {
  day: {
    status: string;
    code: string;
    is_corrected: boolean;
    pending_corrections: number;
    shift: { name: string } | null;
  };
  shift_swap: { shift: { name: string } } | null;
};
type CorrectionAnswer = { correction: { id: string; state: string; is_direct: boolean } };

/** The latest date that is not a Sunday and is at least `daysAgo` days in the past. */
function workingDayBefore(daysAgo: number): Date {
  const day = new Date();
  day.setDate(day.getDate() - daysAgo);
  while (day.getDay() === 0) day.setDate(day.getDate() - 1);
  return day;
}

function addDays(day: Date, days: number): Date {
  const moved = new Date(day);
  moved.setDate(moved.getDate() + days);
  return moved;
}

/** The register's column header for a day of the month ("7", not "07"). */
const dayHeader = (day: Date) => String(day.getDate());

/** In Indian time, as the server wants it (a moment with a time zone). */
const istMoment = (day: Date, clock: string) => `${isoDate(day)}T${clock}:00+05:30`;

/** A row of the monthly register file, with its header row (the header starts "Code", "Name"). */
function monthlyRow(file: ReadXlsx, code: string) {
  for (const sheet of file.sheets) {
    const header = sheet.rows.find((row) => row[0] === "Code" && row[1] === "Name");
    const row = sheet.rows.find((candidate) => candidate[0] === code);
    if (header && row) return { header, row };
  }
  throw new Error(`The monthly register has no row for ${code}.`);
}

function cell(table: { header: string[]; row: string[] }, columnName: string): string {
  const index = table.header.indexOf(columnName);
  if (index < 0) throw new Error(`The register has no column ${columnName}.`);
  return table.row[index] ?? "";
}

test("J-11 correction request and decision, bulk correction after an outage, one-day shift swap", async ({
  page,
  browser,
}) => {
  test.setTimeout(300_000);
  const dayOne = workingDayBefore(3); // the Plant Head's request
  const dayTwo = workingDayBefore(5); // the outage, earlier than the request day
  const today = new Date();

  await logIn(page, SUPER_ADMIN_LOGIN);
  await expect(page.getByRole("heading", { name: /Welcome/ })).toBeVisible();
  const api = adminApi(page);
  const plant = await makePlant(api, "J11A");
  await api.patch(`/plants/${plant.id}`, {
    attendance_start_date: isoDate(addDays(dayTwo, -3)),
  });
  const categories = await api.get<Array<{ id: string; name: string }>>(
    `/plants/${plant.id}/categories`,
  );
  const staff = categories.find((category) => category.name === "Staff");
  if (!staff) throw new Error("A new plant should have the category Staff.");
  const people: Record<string, string> = {};
  for (const [code, name] of [
    ["J11-A", "Asked Journey"],
    ["J11-B", "Rejected Journey"],
    ["J11-C", "Outage Journey"],
    ["J11-D", "Outage Two Journey"],
  ] as const) {
    const made = await api.post<{ id: string }>("/employees", {
      employee_code: code,
      full_name: name,
      type: "permanent",
      plant_id: plant.id,
      category_id: staff.id,
      shift_id: plant.shiftId,
      joined_on: "2020-01-01",
    });
    people[code] = made.id;
  }
  await assignPlant(api, PLANT_HEAD_LOGIN, plant.id);

  const readDay = async (code: string, day: Date) =>
    api.get<DayAnswer>(`/attendance/employee/${people[code]}/day/${isoDate(day)}`);

  const head = await openAs(browser, PLANT_HEAD_LOGIN, "Welcome, E2E Plant Head");
  try {
    // 1. Nobody punched: both days are Absent before any correction.
    expect((await readDay("J11-A", dayOne)).day.status).toBe("absent");
    expect((await readDay("J11-B", dayOne)).day.status).toBe("absent");

    // 2. The Plant Head asks for IN and OUT for two people. Both wait: nothing changes yet.
    const ask = (code: string, reason: string) =>
      tryCall(head.page, "post", "/regularisations", {
        employee_id: people[code],
        attendance_date: isoDate(dayOne),
        kind: "add_in_out",
        in_time: istMoment(dayOne, "07:05"),
        out_time: istMoment(dayOne, "19:05"),
        reason,
      });
    const askedA = await ask("J11-A", "Gate scanner was off");
    const askedB = await ask("J11-B", "Forgot the card");
    expect(askedA.status).toBe(201);
    expect(askedB.status).toBe(201);
    const requestA = (askedA.json as unknown as CorrectionAnswer).correction;
    const requestB = (askedB.json as unknown as CorrectionAnswer).correction;
    expect(requestA).toMatchObject({ state: "pending", is_direct: false });
    expect((await readDay("J11-A", dayOne)).day).toMatchObject({
      status: "absent",
      pending_corrections: 1,
    });
    // A Plant Head cannot decide a request, only the Super Admin can.
    expect((await tryCall(head.page, "post", `/regularisations/${requestA.id}/approve`, {})).status).toBe(
      403,
    );

    // 3. The Super Admin approves the first one on the Corrections screen, and rejects the second
    //    with a reason.
    await page.goto("/admin/corrections");
    const card = page.getByRole("listitem").filter({ hasText: "Asked Journey" });
    await expect(card.getByText("Gate scanner was off")).toBeVisible();
    await card.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText("Request approved")).toBeVisible();
    await api.post(`/regularisations/${requestB.id}/reject`, { reason: "No proof of the visit" });

    // 4. The requester sees both results; the day of the approved one is Present and corrected.
    const mine = await head.api.get<{
      items: Array<{ id: string; state: string; decision: { reason: string | null } | null }>;
    }>("/regularisations?page_size=100");
    const decided = Object.fromEntries(mine.items.map((item) => [item.id, item]));
    expect(decided[requestA.id]?.state).toBe("approved");
    expect(decided[requestB.id]?.state).toBe("rejected");
    expect(decided[requestB.id]?.decision?.reason).toBe("No proof of the visit");
    expect((await readDay("J11-A", dayOne)).day).toMatchObject({
      status: "present",
      is_corrected: true,
      pending_corrections: 0,
    });
    expect((await readDay("J11-B", dayOne)).day.status).toBe("absent");

    // 5. Bulk correction after an outage: two people, one date, checked first, then saved.
    const bulk = {
      plant_id: plant.id,
      attendance_date: isoDate(dayTwo),
      kind: "add_in_out",
      in_time: istMoment(dayTwo, "07:05"),
      out_time: istMoment(dayTwo, "19:05"),
      employee_ids: [people["J11-C"], people["J11-D"]],
      reason: "Gate outage",
    };
    const preview = await api.post<{ will_create: number; will_skip: number }>(
      "/regularisations/bulk/preview",
      bulk,
    );
    expect(preview).toMatchObject({ will_create: 2, will_skip: 0 });
    const saved = await api.post<{ created: number; skipped: unknown[] }>(
      "/regularisations/bulk",
      bulk,
    );
    expect(saved.created).toBe(2);
    expect(saved.skipped).toEqual([]);
    // Doing the same again is refused person by person (a punch already covers the time).
    const again = await api.post<{ created: number; skipped: Array<{ code: string }> }>(
      "/regularisations/bulk",
      bulk,
    );
    expect(again.created).toBe(0);
    expect(again.skipped.map((item) => item.code)).toEqual([
      "CORRECTION_NEAR_PUNCH",
      "CORRECTION_NEAR_PUNCH",
    ]);

    // 6. One-day shift swap: person C works a later shift today. Only the Super Admin may do it.
    const lateShift = await api.post<{ id: string; name: string }>(
      `/plants/${plant.id}/shifts`,
      { name: "J11 Late", start_time: "11:00", end_time: "23:00" },
    );
    const refused = await tryCall(head.page, "post", `/employees/${people["J11-C"]}/shift-swaps`, {
      date: isoDate(today),
      shift_id: lateShift.id,
      reason: "Plant Head tries",
    });
    expect(refused.status).toBe(403);
    const yesterday = await tryCall(page, "post", `/employees/${people["J11-C"]}/shift-swaps`, {
      date: isoDate(addDays(today, -1)),
      shift_id: lateShift.id,
      reason: "Too late to swap",
    });
    expect(yesterday.status).toBe(422);
    expect(yesterday.json.error?.code).toBe("SHIFT_SWAP_INVALID");
    await api.post(`/employees/${people["J11-C"]}/shift-swaps`, {
      date: isoDate(today),
      shift_id: lateShift.id,
      reason: "Journey swap",
    });
    const swapped = await readDay("J11-C", today);
    expect(swapped.shift_swap?.shift.name).toBe("J11 Late");
    expect(swapped.day.shift?.name).toBe("J11 Late");
    // The other person keeps the normal shift on the same day.
    expect((await readDay("J11-D", today)).shift_swap).toBeNull();
  } finally {
    await head.close();
  }

  // 7. Read-back: the day status from the server and the "*" mark in the monthly register FILE.
  expect((await readDay("J11-C", dayTwo)).day).toMatchObject({ status: "present", is_corrected: true });
  const months = new Set([isoDate(dayOne).slice(0, 7), isoDate(dayTwo).slice(0, 7)]);
  for (const month of months) {
    const file = readBack<ReadXlsx>(
      await downloadFile(
        page,
        `/reports/register.xlsx?plant_id=${plant.id}&month=${month}`,
        `j11-register-${month}.xlsx`,
      ),
    );
    const expectPresent = (code: string, day: Date, expected: string) => {
      if (isoDate(day).slice(0, 7) !== month) return;
      expect(cell(monthlyRow(file, code), dayHeader(day)), `${code} on ${isoDate(day)}`).toBe(
        expected,
      );
    };
    expectPresent("J11-A", dayOne, "P*"); // approved request
    expectPresent("J11-B", dayOne, "A"); // rejected request: still absent, no mark
    expectPresent("J11-C", dayTwo, "P*"); // bulk correction
    expectPresent("J11-D", dayTwo, "P*");
    // The legend of the file explains the star.
    expect(JSON.stringify(file.sheets)).toContain("* corrected");
  }
});
