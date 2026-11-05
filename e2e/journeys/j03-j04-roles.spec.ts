// J-03 and J-04 (M6 AC-M6-6): the Corporate Head's changes wait for the Super Admin (one approved,
// one rejected with a reason, the requester sees both results), and the Plant Head sees and changes
// only their own plant. people.spec.ts already proves "create employee, wait, approve"; this file
// adds the rejection, the transfer and the Plant Head's limits.
import { expect, test } from "@playwright/test";
import {
  adminApi,
  assignPlant,
  CORPORATE_HEAD_LOGIN,
  logIn,
  makePermanentEmployee,
  makePlant,
  PLANT_HEAD_LOGIN,
  SUPER_ADMIN_LOGIN,
} from "../tests/helpers";
import { isoDate } from "./golden";
import { openAs, tryCall } from "./journey-helpers";

test.describe.configure({ mode: "serial" });

type Listed = {
  items: Array<{ id: string; plant_code: string; employee_code: string }>;
  total: number;
};
type ChangeRequest = {
  id: string;
  status: string;
  kind: string;
  summary: string;
  decision_reason: string | null;
};

test("J-03 a Corporate Head's new employee and transfer wait; one is approved, one is rejected with a reason", async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  await logIn(page, SUPER_ADMIN_LOGIN);
  await expect(page.getByRole("heading", { name: /Welcome/ })).toBeVisible();
  const api = adminApi(page);
  const plantA = await makePlant(api, "J3A");
  const plantB = await makePlant(api, "J3B");
  const mover = await makePermanentEmployee(api, plantA, "J3-001", "Mover Journey");

  const head = await openAs(browser, CORPORATE_HEAD_LOGIN, "Welcome, E2E Corporate Head");
  try {
    // 1. Two changes: a new employee and a transfer of the mover to plant B. Both answer 202.
    const created = await tryCall(head.page, "post", "/employees", {
      employee_code: "J3-002",
      full_name: "Rejected Journey",
      type: "permanent",
      plant_id: plantA.id,
      category_id: plantA.helperId,
      shift_id: plantA.shiftId,
      joined_on: isoDate(new Date()),
    });
    expect(created.status).toBe(202);
    const transferred = await tryCall(head.page, "post", `/employees/${mover.id}/transfer`, {
      to_plant_id: plantB.id,
      category_id: plantB.helperId,
      shift_id: plantB.shiftId,
      effective_from: isoDate(new Date()),
      reason: "Journey transfer",
    });
    expect(transferred.status).toBe(202);

    // 2. Nothing took effect yet: the mover is still in plant A and the new code is unknown.
    const before = await api.get<Listed>("/employees?page_size=200&q=J3-");
    expect(before.items.map((item) => `${item.employee_code}@${item.plant_code}`)).toEqual([
      "J3-001@J3A",
    ]);

    // 3. The Super Admin sees two waiting requests, approves the transfer, rejects the new person.
    const waiting = await api.get<{ items: ChangeRequest[] }>(
      "/change-requests?status=pending&page_size=200",
    );
    const transferRequest = waiting.items.find((item) => item.summary.includes("Mover Journey"));
    const createRequest = waiting.items.find((item) => item.summary.includes("Rejected Journey"));
    expect(transferRequest, "a waiting transfer request").toBeTruthy();
    expect(createRequest, "a waiting create request").toBeTruthy();
    await api.post(`/change-requests/${transferRequest?.id}/approve`, {});
    await api.post(`/change-requests/${createRequest?.id}/reject`, {
      reason: "Not needed this month",
    });

    // 4. Only the approved change took effect.
    const after = await api.get<Listed>("/employees?page_size=200&q=J3-");
    expect(after.items.map((item) => `${item.employee_code}@${item.plant_code}`)).toEqual([
      "J3-001@J3B",
    ]);

    // 5. The requester sees both results, with the reason of the rejection.
    const mine = await head.api.get<{ items: ChangeRequest[] }>("/change-requests?page_size=200");
    const decided = mine.items.filter(
      (item) =>
        ["approved", "rejected"].includes(item.status) &&
        (item.summary.includes("Mover Journey") || item.summary.includes("Rejected Journey")),
    );
    expect(decided.map((item) => `${item.kind}:${item.status}`).sort()).toEqual([
      "employee.create:rejected",
      "employee.transfer:approved",
    ]);
    expect(decided.find((item) => item.status === "rejected")?.decision_reason).toBe(
      "Not needed this month",
    );
    await head.page.goto("/admin/my-requests");
    await expect(head.page.getByText("Not needed this month")).toBeVisible();
  } finally {
    await head.close();
  }
});

test("J-04 a Plant Head sees only their own plant and cannot open another by its address", async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  await logIn(page, SUPER_ADMIN_LOGIN);
  await expect(page.getByRole("heading", { name: /Welcome/ })).toBeVisible();
  const api = adminApi(page);
  const own = await makePlant(api, "J4A");
  const foreign = await makePlant(api, "J4B");
  await makePermanentEmployee(api, own, "J4-001", "Own Plant Person");
  const outsider = await makePermanentEmployee(api, foreign, "J4-002", "Other Plant Person");
  await assignPlant(api, "e2e.plant", own.id);

  const head = await openAs(browser, PLANT_HEAD_LOGIN, "Welcome, E2E Plant Head");
  try {
    // The list holds only the own plant.
    const listed = await head.api.get<Listed>("/employees?page_size=200&q=J4-");
    expect(listed.items.map((item) => `${item.employee_code}@${item.plant_code}`)).toEqual([
      "J4-001@J4A",
    ]);

    // Another plant, by its address: refused or not found, never data.
    for (const path of [`/employees/${outsider.id}`, `/plants/${foreign.id}`]) {
      const refused = await tryCall(head.page, "get", path);
      expect([403, 404], `GET ${path}`).toContain(refused.status);
    }

    // The role does not change people or users, and the menu is limited.
    const created = await tryCall(head.page, "post", "/employees", {
      employee_code: "J4-003",
      full_name: "Not Allowed",
      type: "permanent",
      plant_id: own.id,
      category_id: own.helperId,
      shift_id: own.shiftId,
      joined_on: isoDate(new Date()),
    });
    expect(created.status).toBe(403);
    await head.page.goto("/admin");
    await expect(head.page.getByRole("link", { name: "Users" })).toHaveCount(0);
    await expect(head.page.getByRole("link", { name: "Approvals" })).toHaveCount(0);
    await expect(head.page.getByRole("link", { name: "Data export" })).toHaveCount(0);

    // Attendance devices of the own plant can be made, those of the other plant cannot.
    const ownDevice = await tryCall(head.page, "post", "/kiosks", {
      plant_id: own.id,
      name: "Journey gate",
    });
    expect(ownDevice.status).toBe(201);
    const foreignDevice = await tryCall(head.page, "post", "/kiosks", {
      plant_id: foreign.id,
      name: "Not allowed gate",
    });
    expect([403, 404]).toContain(foreignDevice.status);
  } finally {
    await head.close();
  }
});
