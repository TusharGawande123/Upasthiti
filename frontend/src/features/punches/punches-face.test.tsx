// The punch log for face punches (spec M3 §4.11, §5.5; AC-24; design gate C, decision 0020): the
// Method column, "By face" and "By code", the "Asked for code" row and its link, the new chips and
// filters, and the details side sheet (scores for the Super Admin only).
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockApi, SUPER_ADMIN } from "../../test/mock-api";
import { CORPORATE_HEAD, PLANT_K134, page } from "../../test/people-fixtures";
import { punchItem, rejectedPunch, summary } from "../../test/punch-fixtures";
import { renderRoute } from "../../test/render";

const NO_PHOTO = { state: "none", is_dark: null, expires_at: null, purged_at: null } as const;
const BY_FACE = punchItem({
  id: "pu-face",
  method: "face",
  match_mode: "one_to_many",
  server_received_at: "2026-10-24T01:34:00Z",
  snapshot: NO_PHOTO,
});
const ASKED = punchItem({
  id: "pu-asked",
  method: "face",
  decision: "needs_code",
  employee: null,
  direction: null,
  reason_codes: ["NEED_EMPLOYEE_CODE"],
  followed_by_punch_id: "pu-code",
  server_received_at: "2026-10-24T01:30:00Z",
  snapshot: {
    state: "stored",
    is_dark: false,
    expires_at: "2026-12-23T01:30:00Z",
    purged_at: null,
  },
});
const BY_CODE = punchItem({
  id: "pu-code",
  method: "face",
  match_mode: "code",
  follows_punch_id: "pu-asked",
  server_received_at: "2026-10-24T01:31:00Z",
  snapshot: NO_PHOTO,
});
const NOT_MATCHED = rejectedPunch("FACE_NOT_RECOGNISED", {
  id: "pu-wrong",
  method: "face",
  match_mode: "code",
  employee: null,
  server_received_at: "2026-10-24T01:20:00Z",
});
const NO_FACE_CARD = punchItem({
  id: "pu-card",
  server_received_at: "2026-10-24T01:10:00Z",
  snapshot: {
    state: "stored",
    is_dark: false,
    expires_at: "2026-12-23T01:10:00Z",
    purged_at: null,
    face_found: false,
  },
});
const ROWS = [BY_FACE, BY_CODE, ASKED, NOT_MATCHED, NO_FACE_CARD];

const FACE_DETAIL = {
  match_score: 0.18,
  second_best_score: null,
  antispoof_score: 0.93,
  yaw_degrees: 26,
  challenge: "turn_left",
  model_id: "buffalo_s",
  match_mode: "code",
  claimed_employee: { id: "e-9", code: "EMP-0457", name: "Ramesh Patil" },
};

const SETTINGS = {
  settings: [
    ["face_match_threshold", 0.45],
    ["face_code_match_threshold", 0.42],
    ["face_antispoof_threshold", 0.8],
    ["face_min_yaw_degrees", 18],
  ].map(([key, value]) => ({
    key,
    group: "face",
    value,
    default: value,
    unit: "",
    used_from: 3,
    editable: true,
    minimum: 0,
    maximum: 100,
    allowed_values: null,
  })),
};

function answers(options: { me?: unknown; detail?: unknown } = {}) {
  const { me = SUPER_ADMIN, detail } = options;
  return {
    "GET /auth/me": { body: me },
    "GET /plants": page([PLANT_K134], 200),
    "GET /change-requests/pending-count": { body: { count: 0 } },
    "GET /qr-cards/expiring-count": { body: { count: 0 } },
    "GET /kiosks": { body: [{ id: "k-1", name: "K134 main gate", plant_id: "p-1" }] },
    "GET /punches": { body: { items: ROWS, page: 1, page_size: 50, total: ROWS.length } },
    "GET /punches/summary": {
      body: summary({
        face_accepted: 1,
        code_accepted: 1,
        asked_for_code: 1,
        no_face_photos: 1,
      }),
    },
    "GET /settings": { body: SETTINGS },
    "GET /punches/pu-wrong": { body: { ...NOT_MATCHED, app_version: "dev", face: detail ?? null } },
    ...(detail === undefined ? {} : {}),
  };
}

async function tableLoaded() {
  await waitFor(() => expect(screen.getAllByRole("row")[1]).toHaveTextContent(/\d\d:\d\d:\d\d/));
}

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:fake-photo");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("punch log: face rows", () => {
  it("shows the method, how each punch was decided and the link between the two code rows", async () => {
    mockApi(answers());

    renderRoute("/admin/punches");
    await tableLoaded();

    const rows = within(screen.getByRole("table")).getAllByRole("row");
    const face = within(rows[1] as HTMLElement);
    expect(face.getByText("Face")).toBeInTheDocument();
    expect(face.getByText("By face")).toBeInTheDocument();
    expect(face.getByText("No photo · accepted face punch")).toBeInTheDocument();
    const code = within(rows[2] as HTMLElement);
    expect(code.getByText("By code")).toBeInTheDocument();
    expect(code.getByRole("button", { name: "After: Asked for code" })).toBeInTheDocument();
    const asked = within(rows[3] as HTMLElement);
    expect(asked.getByText("Asked for code")).toBeInTheDocument();
    expect(asked.getByText("NEED_EMPLOYEE_CODE")).toBeInTheDocument();
    expect(asked.getByRole("button", { name: "Then: By code" })).toBeInTheDocument();
    const wrong = within(rows[4] as HTMLElement);
    expect(wrong.getByText("Code typed, face did not match")).toBeInTheDocument();
    expect(wrong.getByText("Face not matched")).toBeInTheDocument();
    const card = within(rows[5] as HTMLElement);
    expect(card.getByText("Card")).toBeInTheDocument();
    expect(card.getByText("No face in photo")).toBeInTheDocument();
  });

  it("shows the two new chips and who accepted how many, and filters when a chip is pressed", async () => {
    const calls = mockApi(answers());
    const user = userEvent.setup();

    renderRoute("/admin/punches");
    await tableLoaded();
    expect(await screen.findByText(/Accepted by:/)).toBeInTheDocument();

    await user.click(totals().getByRole("button", { name: /Asked for code/ }));

    await waitFor(() =>
      expect(
        calls.some(
          (call) => call.path.startsWith("/punches?") && call.path.includes("asked_for_code=true"),
        ),
      ).toBe(true),
    );
    await user.click(totals().getByRole("button", { name: /No face in photo/ }));
    await waitFor(() =>
      expect(
        calls.some(
          (call) => call.path.startsWith("/punches?") && call.path.includes("no_face_photo=true"),
        ),
      ).toBe(true),
    );
  });

  it("filters by method, with 'Face, by code' as its own choice", async () => {
    const calls = mockApi(answers());
    const user = userEvent.setup();

    renderRoute("/admin/punches");
    await tableLoaded();
    await user.selectOptions(screen.getByLabelText("Method"), "code");

    await waitFor(() =>
      expect(
        calls.some(
          (call) =>
            call.path.startsWith("/punches?") &&
            call.path.includes("method=face") &&
            call.path.includes("match_mode=code"),
        ),
      ).toBe(true),
    );
  });

  it("does not show the No face in photo chip to a Corporate Head", async () => {
    mockApi({
      ...answers({ me: CORPORATE_HEAD }),
      "GET /punches/summary": {
        body: summary({
          face_accepted: 1,
          code_accepted: 1,
          asked_for_code: 1,
          no_face_photos: null,
        }),
      },
    });

    renderRoute("/admin/punches");
    await tableLoaded();

    expect(
      await within(await screen.findByRole("region", { name: "Totals of the day" })).findByRole(
        "button",
        { name: /Asked for code/ },
      ),
    ).toBeInTheDocument();
    expect(totals().queryByRole("button", { name: /No face in photo/ })).not.toBeInTheDocument();
  });
});

describe("punch log: the details sheet", () => {
  it("gives the Super Admin the scores with today's limits, and the code that was typed", async () => {
    mockApi(answers({ detail: FACE_DETAIL }));
    const user = userEvent.setup();

    renderRoute("/admin/punches");
    await tableLoaded();
    await user.click(screen.getByRole("button", { name: "Details of the punch at 06:50:00" }));

    const sheet = await screen.findByRole("dialog");
    expect(
      await within(sheet).findByText("Code typed: EMP-0457 – face did not match"),
    ).toBeInTheDocument();
    expect(within(sheet).getAllByText("Ramesh Patil").length).toBeGreaterThan(0);
    expect(within(sheet).getByText("0.18")).toBeInTheDocument();
    expect(within(sheet).getByText("Too low")).toBeInTheDocument(); // 0.18 against 0.42
    expect(within(sheet).getByText("26° left")).toBeInTheDocument();
    expect(within(sheet).getByText("Employee code (1:1)")).toBeInTheDocument();
    expect(within(sheet).getByText("Today's limit: 0.42 or more")).toBeInTheDocument();
  });

  it("gives other roles the facts as text only: no scores, no typed code, no photo", async () => {
    mockApi(answers({ me: CORPORATE_HEAD }));
    const user = userEvent.setup();

    renderRoute("/admin/punches");
    await tableLoaded();
    await user.click(screen.getByRole("button", { name: "Details of the punch at 06:50:00" }));

    const sheet = await screen.findByRole("dialog");
    expect(
      await within(sheet).findByText(
        "Scores, the typed code and photos are shown to the Super Admin only.",
      ),
    ).toBeInTheDocument();
    expect(within(sheet).queryByText("Match score")).not.toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: "View photo" })).not.toBeInTheDocument();
  });
});

// The chips of the day, apart from the "After / Then" links inside the table rows.
function totals() {
  return within(screen.getByRole("region", { name: "Totals of the day" }));
}
