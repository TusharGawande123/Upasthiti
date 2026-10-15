// Fake people, plants and requests shared by the slice D tests.
import { SUPER_ADMIN } from "./mock-api";

export const CORPORATE_HEAD = {
  ...SUPER_ADMIN,
  id: "u-2",
  name: "Vikram Deshmukh",
  role: "corporate_head",
};
export const PLANT_HEAD = {
  ...SUPER_ADMIN,
  id: "u-3",
  name: "Sunil More",
  role: "plant_head",
  plant_ids: ["p-1"],
};

export const PLANT_K134 = {
  id: "p-1",
  name: "Sheet Shapers (K-134)",
  code: "K134",
  address: "",
  lat: null,
  lon: null,
  is_active: true,
  geofence_set: true,
  active_kiosks: 1,
  active_employees: 2,
};
export const PLANT_X280 = { ...PLANT_K134, id: "p-2", code: "X280", name: "Sheet Shapers (X-280)" };

export function page(items: unknown[], pageSize = 50) {
  return { body: { items, page: 1, page_size: pageSize, total: items.length } };
}

export function employee(overrides: Record<string, unknown> = {}) {
  return {
    id: "e-1",
    employee_code: "1001",
    full_name: "Ramesh Kulkarni",
    type: "permanent",
    plant_id: "p-1",
    plant_code: "K134",
    category_id: "c-1",
    category_name: "Staff",
    department_id: "d-1",
    department_name: "Accounts",
    shift_id: "s-1",
    shift_name: "General",
    contractor_id: null,
    contractor_name: null,
    punch_method: "face",
    hourly_rate: null,
    ot_rate_per_hour: "220.00",
    status: "active",
    joined_on: "2024-04-02",
    left_on: null,
    left_reason: null,
    has_pending_change: false,
    ...overrides,
  };
}

export const RAVI = employee({
  id: "e-2",
  employee_code: "2041",
  full_name: "Ravi Patil",
  type: "temporary",
  plant_id: "p-2",
  plant_code: "X280",
  category_name: "Helper",
  contractor_id: "ct-1",
  contractor_name: "Shree Manpower",
  hourly_rate: "85.00",
  ot_rate_per_hour: null,
  punch_method: "qr",
});

export function changeRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: "r-1",
    kind: "employee.update",
    summary: "Edit Ramesh Kulkarni (1001): overtime rate",
    status: "pending",
    employee_id: "e-1",
    plant_ids: ["p-1"],
    requested_by: "u-2",
    requested_by_name: "Vikram Deshmukh",
    requested_at: "2026-10-14T05:50:00Z",
    decided_by: null,
    decided_at: null,
    decision_reason: null,
    payload: {
      employee_id: "e-1",
      changes: { ot_rate_per_hour: "250.00" },
      reason: "New wage agreement",
    },
    result: null,
    ...overrides,
  };
}
