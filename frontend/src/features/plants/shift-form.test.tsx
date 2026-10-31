// The shift form of the plant page (design gate C screen 4): list rows, the live helper, field
// errors, the date the rules apply from, the rule history and the "print the poster again" message.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockApi, SUPER_ADMIN } from "../../test/mock-api";
import { CORPORATE_HEAD } from "../../test/people-fixtures";
import { renderRoute } from "../../test/render";
import { describeRuleVersions } from "./shift-form-dialog";

// The toast area is not part of the test app, so the message is checked through the toast call.
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const PLANT = {
  id: "p-1",
  name: "Sheet Shapers (K-134)",
  code: "K134",
  address: "",
  lat: null,
  lon: null,
  is_active: true,
  geofence_set: true,
  active_kiosks: 1,
  active_employees: 0,
};

const OFFICE = {
  id: "s-1",
  plant_id: "p-1",
  name: "Office",
  start_time: "09:00:00",
  end_time: "17:00:00",
  crosses_midnight: false,
  shift_length_min: 480,
  grace_min: 30,
  half_day_min: 240,
  overtime_min_minutes: 120,
  is_active: true,
  rules_from: "2026-10-23",
  upcoming_rules: null,
};

function version(from: string, saved: string, grace: number) {
  return {
    effective_from: from,
    start_time: "09:00:00",
    end_time: "17:00:00",
    crosses_midnight: false,
    shift_length_min: 480,
    grace_min: grace,
    half_day_min: 240,
    overtime_min_minutes: 120,
    created_at: `${saved}T05:00:00Z`,
  };
}

function answers(extra: Record<string, unknown> = {}, me: unknown = SUPER_ADMIN) {
  return {
    "GET /auth/me": { body: me },
    "GET /plants/p-1": { body: PLANT },
    "GET /plants/p-1/readiness": { body: { plant_id: "p-1", ready: true } },
    "GET /plants/p-1/weekly-off": { body: { current: null, history: [] } },
    "GET /plants/p-1/shifts": { body: [OFFICE] },
    "GET /shifts/s-1/rule-versions": {
      body: [version("2026-10-11", "2026-10-10", 15), version("2026-10-23", "2026-10-22", 30)],
    },
    ...extra,
  } as Parameters<typeof mockApi>[0];
}

afterEach(() => vi.unstubAllGlobals());

async function openEdit(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("tab", { name: "Shifts" }));
  await user.click(await screen.findByRole("button", { name: "Edit rules" }));
  return within(await screen.findByRole("dialog"));
}

describe("the shift list", () => {
  it("shows the times, full day, grace, half-day and overtime of a shift", async () => {
    mockApi(answers());
    const user = userEvent.setup();

    renderRoute("/admin/plants/p-1");
    await user.click(await screen.findByRole("tab", { name: "Shifts" }));

    expect(await screen.findByText("09:00 – 17:00")).toBeInTheDocument();
    expect(screen.getByText("Full day 8 h")).toBeInTheDocument();
    expect(screen.getByText("Grace 30 min")).toBeInTheDocument();
    expect(screen.getByText("Half-day 4 h")).toBeInTheDocument();
    expect(screen.getByText("Overtime from 2 h")).toBeInTheDocument();
    expect(screen.getByText("Rules shown are the ones in force today")).toBeInTheDocument();
  });

  it("has no Edit or Add buttons for a Corporate Head", async () => {
    mockApi(answers({}, CORPORATE_HEAD));
    const user = userEvent.setup();

    renderRoute("/admin/plants/p-1");
    await user.click(await screen.findByRole("tab", { name: "Shifts" }));

    await screen.findByText("09:00 – 17:00");
    expect(screen.queryByRole("button", { name: "Edit rules" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add shift" })).not.toBeInTheDocument();
  });

  it("shows the rules that start later", async () => {
    mockApi(
      answers({
        "GET /plants/p-1/shifts": {
          body: [{ ...OFFICE, upcoming_rules: version("2026-12-01", "2026-10-30", 20) }],
        },
      }),
    );
    const user = userEvent.setup();

    renderRoute("/admin/plants/p-1");
    await user.click(await screen.findByRole("tab", { name: "Shifts" }));

    expect(await screen.findByText("New rules from 01/12/2026")).toBeInTheDocument();
  });
});

describe("the form", () => {
  it("asks for the times first when adding a shift", async () => {
    mockApi(answers());
    const user = userEvent.setup();

    renderRoute("/admin/plants/p-1");
    await user.click(await screen.findByRole("tab", { name: "Shifts" }));
    await user.click(await screen.findByRole("button", { name: "Add shift" }));
    const dialog = within(await screen.findByRole("dialog"));

    expect(
      dialog.getByText("Enter the start and end times to see what they mean."),
    ).toBeInTheDocument();
    expect(dialog.queryByLabelText("These rules apply from")).not.toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "Save rules" })).toBeDisabled();
  });

  it("shows the full day and the helper lines for the typed values, and updates them", async () => {
    mockApi(answers());
    const user = userEvent.setup();

    renderRoute("/admin/plants/p-1");
    const dialog = await openEdit(user);

    expect(dialog.getByText("Full day: 8 h")).toBeInTheDocument();
    expect(
      dialog.getByText("On time until 09:30. Arriving up to 09:30 counts from 09:00."),
    ).toBeInTheDocument();
    expect(
      dialog.getByText("Full day: 8 h. Arrive by 09:30 and stay until 17:00."),
    ).toBeInTheDocument();
    expect(
      dialog.getByText(
        "Leaving before 17:00 is an early exit. The real hours count; there is no grace at the end.",
      ),
    ).toBeInTheDocument();
    expect(
      dialog.getByText(
        "Half-day from 4 h. Below 4 h is Short hours: you decide that day with a correction.",
      ),
    ).toBeInTheDocument();
    expect(dialog.getByRole("img")).toHaveAccessibleName(/On time until 09:30/);

    fireEvent.change(dialog.getByLabelText("Grace after the start"), { target: { value: "15" } });
    expect(
      await dialog.findByText("On time until 09:15. Arriving up to 09:15 counts from 09:00."),
    ).toBeInTheDocument();
  });

  it("refuses a grace above 120 minutes", async () => {
    mockApi(answers());
    const user = userEvent.setup();

    renderRoute("/admin/plants/p-1");
    const dialog = await openEdit(user);
    fireEvent.change(dialog.getByLabelText("Grace after the start"), { target: { value: "121" } });

    expect(dialog.getByText("Grace can be 0 to 120 minutes.")).toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "Save rules" })).toBeDisabled();
    expect(dialog.queryByText("What these times mean")).not.toBeInTheDocument();
  });

  it("refuses a half-day that is not shorter than the full day and hides the helper", async () => {
    mockApi(answers());
    const user = userEvent.setup();

    renderRoute("/admin/plants/p-1");
    const dialog = await openEdit(user);
    fireEvent.change(dialog.getByLabelText("Half-day hours"), { target: { value: "8" } });

    expect(
      dialog.getByText("Half-day must be shorter than the full day (8 h)."),
    ).toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "Save rules" })).toBeDisabled();
    expect(dialog.queryByText("What these times mean")).not.toBeInTheDocument();
  });

  it("explains a night shift", async () => {
    mockApi(
      answers({
        "GET /plants/p-1/shifts": {
          body: [
            {
              ...OFFICE,
              name: "Night",
              start_time: "19:00:00",
              end_time: "07:00:00",
              crosses_midnight: true,
              shift_length_min: 720,
            },
          ],
        },
      }),
    );
    const user = userEvent.setup();

    renderRoute("/admin/plants/p-1");
    const dialog = await openEdit(user);

    expect(dialog.getByText("Ends the next day")).toBeInTheDocument();
    expect(dialog.getByText("Full day: 12 h")).toBeInTheDocument();
    expect(dialog.getByText(/This shift ends the next morning/)).toBeInTheDocument();
  });

  it("notes a future date and refuses a past one", async () => {
    mockApi(answers());
    const user = userEvent.setup();

    renderRoute("/admin/plants/p-1");
    const dialog = await openEdit(user);
    fireEvent.change(dialog.getByLabelText("These rules apply from"), {
      target: { value: "2099-01-05" },
    });
    expect(dialog.getByText(/Starts on 05\/01\/2099/)).toBeInTheDocument();

    fireEvent.change(dialog.getByLabelText("These rules apply from"), {
      target: { value: "2020-01-05" },
    });
    expect(dialog.getByText("Choose today or a later date.")).toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "Save rules" })).toBeDisabled();
  });

  it("lists the rule history with In force and Earlier", async () => {
    mockApi(answers());
    const user = userEvent.setup();

    renderRoute("/admin/plants/p-1");
    const dialog = await openEdit(user);

    expect(await dialog.findByText("From 23/10/2026")).toBeInTheDocument();
    expect(dialog.getByText("From 11/10/2026")).toBeInTheDocument();
    expect(dialog.getByText("In force")).toBeInTheDocument();
    expect(dialog.getByText("Earlier")).toBeInTheDocument();
    expect(dialog.getByText("Saved on 22/10/2026")).toBeInTheDocument();
    expect(dialog.getByText(/Days already worked keep the rules of their day/)).toBeInTheDocument();
  });

  it("saves, then tells the Super Admin to print the gate poster again", async () => {
    const calls = mockApi(answers({ "PATCH /shifts/s-1": { body: OFFICE } }));
    const user = userEvent.setup();

    renderRoute("/admin/plants/p-1");
    const dialog = await openEdit(user);
    fireEvent.change(dialog.getByLabelText("Grace after the start"), { target: { value: "20" } });
    await user.click(dialog.getByRole("button", { name: "Save rules" }));

    await waitFor(() => expect(calls.some((call) => call.method === "PATCH")).toBe(true));
    expect(calls.find((call) => call.method === "PATCH")?.body).toMatchObject({ grace_min: 20 });
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "Shift times changed. Print the gate poster again.",
        expect.objectContaining({
          action: expect.objectContaining({ label: "Open the gate poster" }),
        }),
      ),
    );
  });
});

describe("rule version states", () => {
  it("tells will apply, in force and earlier apart", () => {
    const rows = describeRuleVersions(
      [
        version("2026-10-11", "2026-10-10", 15),
        version("2026-12-01", "2026-10-30", 20),
        version("2026-10-23", "2026-10-22", 30),
      ],
      "2026-10-31",
    );
    expect(rows.map((row) => [row.version.effective_from, row.state])).toEqual([
      ["2026-12-01", "willApply"],
      ["2026-10-23", "inForce"],
      ["2026-10-11", "earlier"],
    ]);
  });

  it("lets the latest save win on the same date", () => {
    const rows = describeRuleVersions(
      [version("2026-10-23", "2026-10-22", 30), version("2026-10-23", "2026-10-25", 10)],
      "2026-10-31",
    );
    expect(rows[0]?.version.grace_min).toBe(10);
    expect(rows[0]?.state).toBe("inForce");
    expect(rows[1]?.state).toBe("earlier");
  });
});
