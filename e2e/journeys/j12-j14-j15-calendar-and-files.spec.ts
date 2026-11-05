// J-12, J-14 and J-15 (M6 AC-M6-7): leave, a plant holiday, then every report and range register is
// downloaded and OPENED AGAIN; the header, the title and the chosen cells are compared with the
// numbers worked out by hand in golden.ts. Nobody punches in this journey, so the file holds only
// what the calendar says. conversion-and-range.spec.ts proves the screens; this proves the files.
import { expect, test } from "@playwright/test";
import { adminApi, logIn, makePlant, SUPER_ADMIN_LOGIN } from "../tests/helpers";
import { calendarGolden, REPORT_TITLES } from "./golden";
import {
  anySheetCellContains,
  cellUnder,
  downloadFile,
  type ReadPdf,
  type ReadXlsx,
  readBack,
  registerRow,
} from "./journey-helpers";

test.describe.configure({ mode: "serial" });

const golden = calendarGolden();
let plantId = "";
let employeeId = "";

test("J-12 a plant holiday and paid leave are saved, and the screens list them", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await logIn(page, SUPER_ADMIN_LOGIN);
  await expect(page.getByRole("heading", { name: /Welcome/ })).toBeVisible();
  const api = adminApi(page);
  const plant = await makePlant(api, golden.plantCode);
  plantId = plant.id;
  // The plant starts counting attendance on the first day of last month.
  await api.patch(`/plants/${plant.id}`, { attendance_start_date: golden.monthStart });
  const employee = await api.post<{ id: string }>("/employees", {
    employee_code: golden.employeeCode,
    full_name: golden.employeeName,
    type: "permanent",
    plant_id: plant.id,
    category_id: (await makePermanentEmployeeCategory(api, plant.id)).id,
    shift_id: plant.shiftId,
    joined_on: "2020-01-01",
  });
  employeeId = employee.id;

  await api.post("/holidays", {
    date: golden.holidayDate,
    name: "Journey holiday",
    is_paid: true,
    all_plants: false,
    plant_ids: [plant.id],
  });
  await api.post("/leave", {
    employee_id: employee.id,
    from_date: golden.leaveFrom,
    to_date: golden.leaveTo,
    is_paid: true,
    reason: "Journey leave",
  });

  await page.goto("/admin/holidays");
  await expect(page.getByText("Journey holiday")).toBeVisible();
  await page.goto("/admin/leave");
  await expect(page.getByText(golden.employeeName)).toBeVisible();
});

test("J-15 the register of a period, as Excel and PDF, holds the holiday and the leave", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await logIn(page, SUPER_ADMIN_LOGIN);
  await expect(page.getByRole("heading", { name: /Welcome/ })).toBeVisible();
  const query = `plant_id=${plantId}&date_from=${golden.monthStart}&date_to=${golden.monthEnd}`;

  const xlsxPath = await downloadFile(
    page,
    `/reports/register-range.xlsx?${query}`,
    "j15-range.xlsx",
  );
  const xlsx = readBack<ReadXlsx>(xlsxPath);
  const table = registerRow(xlsx, golden.employeeCode);
  expect(cellUnder(table, golden.holidayColumn)).toBe("H");
  for (const column of golden.leaveColumns) {
    expect(cellUnder(table, column), `leave day ${column}`).toBe("PL");
  }
  expect(cellUnder(table, "Leave")).toBe(golden.leaveTotal);
  expect(cellUnder(table, "H")).toBe(golden.holidayTotal);
  expect(xlsx.sheets[0]?.rows[2]?.[0]).toContain(golden.plantCode);

  const pdfPath = await downloadFile(page, `/reports/register-range.pdf?${query}`, "j15-range.pdf");
  const pdf = readBack<ReadPdf>(pdfPath);
  expect(pdf.pages).toBeGreaterThanOrEqual(1);
  expect(pdf.text.join(" ")).toContain(golden.employeeCode);

  // One employee, day by day, for the same period.
  const employeePath = await downloadFile(
    page,
    `/reports/employee-range.xlsx?employee_id=${employeeId}&date_from=${golden.monthStart}&date_to=${golden.monthEnd}`,
    "j15-employee.xlsx",
  );
  const employeeFile = readBack<ReadXlsx>(employeePath);
  expect(anySheetCellContains(employeeFile, golden.employeeName)).toBe(true);
});

test("J-14 each of the seven reports opens again with its title and plant", async ({ page }) => {
  test.setTimeout(300_000);
  await logIn(page, SUPER_ADMIN_LOGIN);
  await expect(page.getByRole("heading", { name: /Welcome/ })).toBeVisible();
  const periods: Record<string, string> = {
    "daily-muster": `date=${golden.holidayDate}`,
    register: `month=${golden.month}`,
    "contractor-hours": `month=${golden.month}`,
    "late-early-overtime": `date_from=${golden.monthStart}&date_to=${golden.monthEnd}`,
    exceptions: `date_from=${golden.monthStart}&date_to=${golden.monthEnd}`,
    "rejected-punches": `date_from=${golden.monthStart}&date_to=${golden.monthEnd}`,
    corrections: `date_from=${golden.monthStart}&date_to=${golden.monthEnd}`,
  };

  for (const [kind, title] of Object.entries(REPORT_TITLES)) {
    const path = `/reports/${kind}.xlsx?plant_id=${plantId}&${periods[kind]}`;
    const file = readBack<ReadXlsx>(await downloadFile(page, path, `j14-${kind}.xlsx`));
    const firstSheet = file.sheets[0];
    expect(firstSheet?.rows[1]?.[0], `${kind}: title row`).toBe(title);
    expect(firstSheet?.rows[2]?.[0], `${kind}: plant row`).toContain(golden.plantCode);
  }

  // The monthly register lists only stored days (made by the daily job), so this plant's new
  // employee has no row yet; the holiday and leave cells are proved in J-15 by the range register.

  // Two of the reports as PDF (all seven are built from the same model as the Excel files).
  for (const kind of ["register", "daily-muster"] as const) {
    const path = `/reports/${kind}.pdf?plant_id=${plantId}&${periods[kind]}`;
    const pdf = readBack<ReadPdf>(await downloadFile(page, path, `j14-${kind}.pdf`));
    expect(pdf.text.join(" ")).toContain(REPORT_TITLES[kind]);
  }
});

/** The category "Staff" of the plant (a permanent employee needs one). */
async function makePermanentEmployeeCategory(
  api: ReturnType<typeof adminApi>,
  forPlantId: string,
): Promise<{ id: string }> {
  const categories = await api.get<Array<{ id: string; name: string }>>(
    `/plants/${forPlantId}/categories`,
  );
  const staff = categories.find((category) => category.name === "Staff");
  if (!staff) throw new Error("A new plant should have the category Staff.");
  return staff;
}
