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
