// The M5 settings cards: attendance days, alerts and email, the attendance device screen lines
// with their previews, and the plant readiness lines for the start date and the weekly off.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiError, mockApi, SUPER_ADMIN } from "../../test/mock-api";
import { renderRoute } from "../../test/render";

function setting(key: string, group: string, value: number | string, extra = {}) {
  return {
    key,
    group,
    value,
    default: value,
    unit: "",
    used_from: 5,
    editable: true,
    minimum: null,
    maximum: null,
    allowed_values: null,
    ...extra,
  };
}

const ON_OFF = { allowed_values: ["on", "off"] };

const SETTINGS = {
  settings: [
    setting("attendance_window_before_hours", "attendance", 4, {
      unit: "h",
      minimum: 1,
      maximum: 8,
    }),
    setting("still_inside_alert_minutes", "alerts", 60, { unit: "min", minimum: 15, maximum: 240 }),
    setting("email_alerts", "alerts", "off", ON_OFF),
    setting("kiosk_show_inside_count", "kiosk_screen", "on", ON_OFF),
    setting("kiosk_late_hint", "kiosk_screen", "off", ON_OFF),
    setting("kiosk_show_month_line", "kiosk_screen", "off", ON_OFF),
  ],
};

function preferences(configured: boolean) {
  return {
    email_enabled: false,
    email_kinds: [],
    email_configured: configured,
    has_email: true,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("the M5 settings cards", () => {
  it("shows the new cards with their labels, ranges and units", async () => {
    mockApi({
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /settings": { body: SETTINGS },
      "GET /me/notification-preferences": { body: preferences(false) },
    });

    renderRoute("/admin/settings");

    expect(await screen.findByLabelText("Day starts before the shift")).toBeInTheDocument();
    expect(screen.getByText(/allowed 1–8/)).toBeInTheDocument();
    expect(screen.getByLabelText("Still inside after the shift")).toHaveValue("60");
    expect(screen.getAllByText("New in this version").length).toBe(3);
  });

  it("replaces the email switch with a note while email is not set up", async () => {
    mockApi({
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /settings": { body: SETTINGS },
      "GET /me/notification-preferences": { body: preferences(false) },
    });

    renderRoute("/admin/settings");

    expect(await screen.findByText("Email is not set up on this server.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Email alerts")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send a test email" })).not.toBeInTheDocument();
  });

  it("shows the email switch and sends a test email when email is set up", async () => {
    const calls = mockApi({
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /settings": { body: SETTINGS },
      "GET /me/notification-preferences": { body: preferences(true) },
      "POST /notifications/test-email": { status: 202, body: { sent: true } },
    });
    const user = userEvent.setup();

    renderRoute("/admin/settings");
    await screen.findByLabelText("Email alerts");
    await user.click(await screen.findByRole("button", { name: "Send a test email" }));

    await waitFor(() =>
      expect(calls.some((call) => call.path === "/notifications/test-email")).toBe(true),
    );
  });

  it("shows a preview of each attendance device line and warns about the month line", async () => {
    mockApi({
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /settings": { body: SETTINGS },
      "GET /me/notification-preferences": { body: preferences(false) },
    });
    const user = userEvent.setup();

    renderRoute("/admin/settings");

    expect(await screen.findByText("Inside now: 214")).toBeInTheDocument();
    expect(screen.getByText("You are 40 minutes late today.")).toBeInTheDocument();
    expect(screen.queryByText(/People standing behind can read it/)).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('"My month" line at the gate'), "on");
    expect(screen.getByText(/People standing behind can read it/)).toBeInTheDocument();
  });

  it("refuses a value outside the range and saves the right payload", async () => {
    const calls = mockApi({
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /settings": { body: SETTINGS },
      "GET /me/notification-preferences": { body: preferences(false) },
      "PUT /settings": { body: SETTINGS },
    });
    const user = userEvent.setup();

    renderRoute("/admin/settings");
    const field = await screen.findByLabelText("Day starts before the shift");
    await user.clear(field);
    await user.type(field, "9");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    await user.clear(field);
    await user.type(field, "5");
    await user.selectOptions(screen.getByLabelText("Gentle late hint at the gate"), "on");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Reason"), "Night shift starts earlier");
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(calls.find((call) => call.method === "PUT")?.body).toEqual({
        values: { attendance_window_before_hours: 5, kiosk_late_hint: "on" },
        reason: "Night shift starts earlier",
      }),
    );
  });

  it("explains a day window that does not fit the longest shift, with the real numbers", async () => {
    mockApi({
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /settings": { body: SETTINGS },
      "GET /me/notification-preferences": { body: preferences(false) },
      "PUT /settings": apiError(422, "SETTING_INVALID", {
        key: "attendance_window_before_hours",
        longest_shift_min: 1020,
      }),
    });
    const user = userEvent.setup();

    renderRoute("/admin/settings");
    const field = await screen.findByLabelText("Day starts before the shift");
    await user.clear(field);
    await user.type(field, "8");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Reason"), "Longer window wanted");
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    expect(
      await within(dialog).findByText(
        "Must be below 7 hours. The longest active shift is 17 hours (24 - 17 = 7).",
      ),
    ).toBeInTheDocument();
  });
});
