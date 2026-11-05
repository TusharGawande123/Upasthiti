// J-18 (M6): the public privacy notice, a data request written into the register and taken through
// its steps, and the full export, which is opened again: its manifest must agree with the
// database (the number of employees) and must not hold any face data.
import { expect, test } from "@playwright/test";
import { FRONTEND_URL } from "../backend-env";
import {
  adminApi,
  E2E_PASSWORD,
  logIn,
  makePermanentEmployee,
  makePlant,
  SUPER_ADMIN_LOGIN,
} from "../tests/helpers";
import { todayInIndia } from "./golden";
import { downloadFile, type ReadZip, readBack } from "./journey-helpers";

test("J-18 privacy notice, data-request register and the full export read back", async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);

  // The notice needs no login.
  const reader = await browser.newContext({ baseURL: FRONTEND_URL, locale: "en-IN" });
  const notice = await reader.newPage();
  await notice.goto("/privacy");
  await expect(
    notice.getByRole("heading", { name: "Face and photo attendance at Sheet Shapers" }),
  ).toBeVisible();
  await reader.close();

  await logIn(page, SUPER_ADMIN_LOGIN);
  await expect(page.getByRole("heading", { name: /Welcome/ })).toBeVisible();
  const api = adminApi(page);
  const plant = await makePlant(api, "J18");
  const employee = await makePermanentEmployee(api, plant, "J18-001", "Privacy Journey Person");

  // 1. A data request is written into the register and goes through two steps.
  const today = todayInIndia();
  const created = await api.post<{
    id: string;
    status: string;
    received_on: string;
    due_on: string;
  }>("/data-requests", {
    kind: "access",
    employee_id: employee.id,
    channel: "in_person",
    received_on: today,
    note: "Journey request",
  });
  expect(created.status).toBe("open");
  expect(created.due_on > created.received_on).toBe(true);
  await api.post(`/data-requests/${created.id}/events`, {
    event_type: "identity_checked",
    detail: "Checked the staff card at the plant office",
  });
  const afterCheck = await api.get<{ status: string; events: Array<{ event_type: string }> }>(
    `/data-requests/${created.id}`,
  );
  expect(afterCheck.status).toBe("identity_checked");
  await api.post(`/data-requests/${created.id}/events`, {
    event_type: "action_taken",
    detail: "Prepared a copy of the person's data",
  });
  await api.post(`/data-requests/${created.id}/events`, {
    event_type: "answer_sent",
    detail: "Handed the copy to the person",
  });
  await api.post(`/data-requests/${created.id}/events`, {
    event_type: "closed",
    detail: "Copy of the data handed over",
    outcome: "done",
  });
  const closed = await api.get<{ status: string; outcome: string; days_left: number | null }>(
    `/data-requests/${created.id}`,
  );
  expect(closed.status).toBe("closed");
  expect(closed.outcome).toBe("done");
  expect(closed.days_left).toBeNull();

  // 2. The register page lists it.
  await page.goto("/admin/privacy-requests");
  await expect(page.getByRole("heading").first()).toBeVisible();
  await expect(page.getByText("Privacy Journey Person").first()).toBeVisible();

  // 3. The full export is downloaded and opened again.
  const zipPath = await downloadFile(page, "/exports/full", "j18-export.zip", "post", {
    reason: "Journey read-back",
    password: E2E_PASSWORD,
  });
  const zip = readBack<ReadZip>(zipPath);
  expect(zip.manifest, "the zip has a manifest.json").not.toBeNull();
  // The expect above already proved the manifest exists.
  const manifest = zip.manifest as NonNullable<ReadZip["manifest"]>;
  expect(manifest.total_rows).toBe(manifest.files.reduce((sum, file) => sum + file.rows, 0));
  for (const file of manifest.files) {
    expect(zip.names, `${file.file} is in the zip`).toContain(file.file);
  }
  const employeesFile = manifest.files.find((file) => file.table === "employees");
  const active = await api.get<{ total: number }>("/employees?page_size=1&status=active");
  const left = await api.get<{ total: number }>("/employees?page_size=1&status=left");
  expect(employeesFile?.rows).toBe(active.total + left.total);
  // No secret column leaves the building: the sealed face template, the passkey credential and
  // key, password hashes and session tokens are in no file of the export (only metadata is).
  const secretColumns =
    /^(ciphertext|nonce|password_hash|credential_id|public_key|user_handle|token_hash)$/;
  for (const [file, columns] of Object.entries(zip.csv_headers)) {
    expect(columns.filter((column) => secretColumns.test(column)), `${file} has no secret column`)
      .toEqual([]);
  }
  expect(Object.keys(zip.csv_headers).length).toBeGreaterThan(10);
});
