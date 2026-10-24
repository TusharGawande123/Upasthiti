// Settings screen: editable and locked settings, range check and saving with a reason.
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockApi, SUPER_ADMIN } from "../../test/mock-api";
import { renderRoute } from "../../test/render";

const SETTINGS = {
  settings: [
    {
      key: "gps_accuracy_limit_m",
      group: "kiosk",
      value: 50,
      default: 50,
      unit: "m",
      used_from: 1,
      editable: true,
      minimum: 10,
      maximum: 200,
      allowed_values: null,
    },
    {
      key: "punch_cooldown_minutes",
      group: "punch",
      value: 2,
      default: 2,
      unit: "min",
      used_from: 2,
      editable: false,
      minimum: 1,
      maximum: 30,
      allowed_values: null,
    },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("settings screen (spec AC-12)", () => {
  it("locks settings of a later milestone", async () => {
    mockApi({ "GET /auth/me": { body: SUPER_ADMIN }, "GET /settings": { body: SETTINGS } });

    renderRoute("/admin/settings");

    expect(await screen.findByText("Used from M2")).toBeInTheDocument();
    expect(screen.getByLabelText("Punch cool-down")).toHaveAttribute("readonly");
    expect(screen.getByLabelText("GPS accuracy limit")).not.toHaveAttribute("readonly");
  });

  it("refuses a value outside the range and keeps Save off", async () => {
    mockApi({ "GET /auth/me": { body: SUPER_ADMIN }, "GET /settings": { body: SETTINGS } });
    const user = userEvent.setup();

    renderRoute("/admin/settings");
    const field = await screen.findByLabelText("GPS accuracy limit");
    await user.clear(field);
    await user.type(field, "5");

    expect(screen.getByText("Use a value from 10 to 200.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  it("saves a changed value together with a reason", async () => {
    const calls = mockApi({
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /settings": { body: SETTINGS },
      "PUT /settings": { body: SETTINGS },
    });
    const user = userEvent.setup();

    renderRoute("/admin/settings");
    const field = await screen.findByLabelText("GPS accuracy limit");
    await user.clear(field);
    await user.type(field, "30");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Reason"), "Gate phones are accurate");
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    const sent = calls.find((call) => call.method === "PUT");
    expect(sent?.body).toEqual({
      values: { gps_accuracy_limit_m: 30 },
      reason: "Gate phones are accurate",
    });
  });

  it("is read-only for a Plant Head", async () => {
    mockApi({
      "GET /auth/me": { body: { ...SUPER_ADMIN, role: "plant_head" } },
      "GET /settings": { body: SETTINGS },
    });

    renderRoute("/admin/settings");

    expect(await screen.findByLabelText("GPS accuracy limit")).toHaveAttribute("readonly");
    expect(screen.getByText(/Only the Super Admin can change them/)).toBeInTheDocument();
  });
});

// The face and privacy settings (spec M3 §4.12, design gate C, decision 0020).
const FACE_SETTINGS = {
  settings: [
    {
      key: "face_match_threshold",
      group: "face",
      value: 0.45,
      default: 0.45,
      unit: "",
      used_from: 3,
      editable: true,
      minimum: 0.2,
      maximum: 0.9,
      allowed_values: null,
      report_value: 0.46,
    },
    {
      key: "face_code_offer_floor",
      group: "face",
      value: 0.3,
      default: 0.3,
      unit: "",
      used_from: 3,
      editable: true,
      minimum: 0.1,
      maximum: 0.8,
      allowed_values: null,
      report_value: null,
    },
    {
      key: "face_challenge_seconds",
      group: "face",
      value: 10,
      default: 10,
      unit: "s",
      used_from: 3,
      editable: true,
      minimum: 5,
      maximum: 30,
      allowed_values: null,
      report_value: null,
    },
    {
      key: "company_address",
      group: "privacy",
      value: "",
      default: "",
      unit: "",
      used_from: 3,
      editable: true,
      minimum: 5,
      maximum: 300,
      allowed_values: null,
      is_text: true,
    },
    {
      key: "privacy_contact",
      group: "privacy",
      value: "Asha Rao, Super Admin",
      default: "",
      unit: "",
      used_from: 3,
      editable: true,
      minimum: 5,
      maximum: 200,
      allowed_values: null,
      is_text: true,
    },
  ],
};

describe("face and privacy settings (spec M3 §4.12)", () => {
  it("shows the report value beside a threshold, and 'No report yet' where there is none", async () => {
    mockApi({ "GET /auth/me": { body: SUPER_ADMIN }, "GET /settings": { body: FACE_SETTINGS } });
    const user = userEvent.setup();

    renderRoute("/admin/settings");

    expect(await screen.findByText("Report value: 0.46")).toBeInTheDocument();
    expect(screen.getByText("No report yet")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Use 0.46" }));
    expect(screen.getByLabelText("Face match threshold")).toHaveValue("0.46");
  });

  it("warns when a threshold is lowered", async () => {
    mockApi({ "GET /auth/me": { body: SUPER_ADMIN }, "GET /settings": { body: FACE_SETTINGS } });
    const user = userEvent.setup();

    renderRoute("/admin/settings");
    const field = await screen.findByLabelText("Face match threshold");
    await user.clear(field);
    await user.type(field, "0.40");

    expect(screen.getByText("A lower threshold lets more strangers through.")).toBeInTheDocument();
  });

  it("refuses a code-entry floor that is not below the match threshold", async () => {
    mockApi({ "GET /auth/me": { body: SUPER_ADMIN }, "GET /settings": { body: FACE_SETTINGS } });
    const user = userEvent.setup();

    renderRoute("/admin/settings");
    const floor = await screen.findByLabelText("Ask-for-code floor");
    await user.clear(floor);
    await user.type(floor, "0.5");

    expect(
      screen.getByText("The code-entry floor must be lower than the match threshold."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  it("asks for the company address and saves it as text with a reason", async () => {
    const calls = mockApi({
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /settings": { body: FACE_SETTINGS },
      "PUT /settings": { body: FACE_SETTINGS },
    });
    const user = userEvent.setup();

    renderRoute("/admin/settings");
    expect(await screen.findByText(/Set this before the first enrolment/)).toBeInTheDocument();
    expect(screen.getByText("[company address not set]")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Company address"), "Plot 1, MIDC Waluj");
    expect(screen.getByText("18 / 300 · at least 5")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Company address:/)).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("Reason"), "Needed for the consent text");
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    const sent = calls.find((call) => call.method === "PUT");
    expect(sent?.body).toEqual({
      values: { company_address: "Plot 1, MIDC Waluj" },
      reason: "Needed for the consent text",
    });
  });

  it("is read-only for a Plant Head, with the report values still visible", async () => {
    mockApi({
      "GET /auth/me": { body: { ...SUPER_ADMIN, role: "plant_head" } },
      "GET /settings": { body: FACE_SETTINGS },
    });

    renderRoute("/admin/settings");

    expect(await screen.findByLabelText("Face match threshold")).toHaveAttribute("readonly");
    expect(screen.getByLabelText("Company address")).toHaveAttribute("readonly");
    expect(screen.getByText("Report value: 0.46")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Use 0.46" })).not.toBeInTheDocument();
  });
});
