// More phone page tests (M4b P4): the password step, punch results, passkey helpers and page, and
// the menu. A page that needs router state (the proof token) is rendered in its own small router.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiError, mockApi } from "../../test/mock-api";
import { renderRoute } from "../../test/render";
import type { PhonePunchAnswer } from "./phone-api";
import { fromBase64Url, toBase64Url } from "./phone-passkey-support";
import { PhonePasswordPage } from "./phone-password-page";
import { PunchResult } from "./phone-punch-result";

const ME = {
  employee: {
    code: "E0412",
    name: "Sunita Jadhav",
    first_name: "Sunita",
    plant: { id: "p-1", code: "K134", name: "Sheet Shapers Waluj" },
    punch_method: "face",
  },
  access: { outside_work_allowed: false, outside_work_until: null },
  notice: { required: false, version: "1" },
  ready: { face: true },
  passkeys: [
    {
      id: "k-1",
      label: "Chrome on Android",
      created_at: "2026-10-30T05:00:00Z",
      last_used_at: null,
    },
  ],
  today: { last_punch: null },
  settings: {
    gps_accuracy_limit_m: 50,
    location_max_age_seconds: 60,
    challenge_seconds: 10,
    photo_ready_seconds: 20,
    capture: {},
  },
  geofence: null,
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-02T04:30:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function renderPasswordPage(state: object | null) {
  const router = createMemoryRouter(
    [
      { path: "/phone/setup/password", element: <PhonePasswordPage /> },
      { path: "/phone/setup", element: <p>setup page</p> },
      { path: "/phone", element: <p>home page</p> },
      { path: "/phone/notice", element: <p>notice page</p> },
    ],
    { initialEntries: [{ pathname: "/phone/setup/password", state }] },
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

describe("set your password", () => {
  it("goes back to the check when there is no proof", async () => {
    mockApi({});
    const router = renderPasswordPage(null);
    await waitFor(() => expect(router.state.location.pathname).toBe("/phone/setup"));
  });

  it("saves only when every rule is done, then signs in", async () => {
    const calls = mockApi({
      "POST /phone/password": {
        body: { employee: ME.employee, notice_required: false },
      },
    });
    const user = userEvent.setup();
    const router = renderPasswordPage({
      proofToken: "t".repeat(43),
      firstName: "Sunita",
      employeeCode: "E0412",
    });
    expect(screen.getByText("Check passed, Sunita")).toBeInTheDocument();
    const save = screen.getByRole("button", { name: "Save and sign in" });
    expect(save).toBeDisabled();

    await user.type(screen.getByLabelText("New password"), "Good-Pass-77");
    await user.type(screen.getByLabelText("Type it again"), "Good-Pass-7");
    expect(
      screen.getByText("The two passwords are not the same. Please type it again."),
    ).toBeInTheDocument();
    expect(save).toBeDisabled();
    await user.type(screen.getByLabelText("Type it again"), "7");
    expect(save).toBeEnabled();
    await user.click(save);

    await waitFor(() => expect(router.state.location.pathname).toBe("/phone"));
    expect(calls.find((call) => call.path === "/phone/password")?.body).toEqual({
      proof_token: "t".repeat(43),
      new_password: "Good-Pass-77",
    });
  });

  it("offers to check again when the proof has expired", async () => {
    mockApi({ "POST /phone/password": apiError(401, "PROOF_TOKEN_INVALID") });
    const user = userEvent.setup();
    renderPasswordPage({ proofToken: "t".repeat(43), firstName: "Sunita", employeeCode: "E0412" });
    await user.type(screen.getByLabelText("New password"), "Good-Pass-77");
    await user.type(screen.getByLabelText("Type it again"), "Good-Pass-77");
    await user.click(screen.getByRole("button", { name: "Save and sign in" }));
    expect(
      await screen.findByText("This check has expired. Please check again."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Check again" })).toHaveAttribute(
      "href",
      "/phone/setup",
    );
  });
});

const ANSWER: PhonePunchAnswer = {
  punch_id: "p-9",
  decision: "accepted",
  reason_code: null,
  direction: "in",
  punch_time: "2026-11-02T01:32:00Z",
  outside_plant: false,
  details: {},
};

describe("punch result", () => {
  it("shows IN with the time and plant, and the outside-plant line when it applies", () => {
    const { rerender } = render(
      <PunchResult answer={ANSWER} plantName="Waluj" onBack={() => {}} onRetry={() => {}} />,
    );
    expect(screen.getByText("IN")).toBeInTheDocument();
    expect(screen.getByText("07:02")).toBeInTheDocument();
    expect(screen.queryByText(/outside-plant punch/)).not.toBeInTheDocument();
    rerender(
      <PunchResult
        answer={{ ...ANSWER, direction: "out", outside_plant: true }}
        plantName="Waluj"
        onBack={() => {}}
        onRetry={() => {}}
      />,
    );
    expect(screen.getByText("OUT")).toBeInTheDocument();
    expect(
      screen.getByText("Saved as an outside-plant punch. The office will check it."),
    ).toBeInTheDocument();
  });

  it("refuses in words that end with the plant office line, with no retry for a refusal", async () => {
    const onBack = vi.fn();
    render(
      <PunchResult
        answer={{
          ...ANSWER,
          decision: "rejected",
          direction: null,
          reason_code: "OUTSIDE_GEOFENCE",
        }}
        plantName="Waluj"
        onBack={onBack}
        onRetry={() => {}}
      />,
    );
    expect(screen.getByText("You are not at the plant.")).toBeInTheDocument();
    expect(screen.getByText("Please visit the plant office.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalled();
  });

  it("offers Try again for a camera hint", () => {
    render(
      <PunchResult
        answer={{
          ...ANSWER,
          decision: "rejected",
          direction: null,
          reason_code: "LIVENESS_FAILED",
          details: { retry_allowed: true },
        }}
        plantName="Waluj"
        onBack={() => {}}
        onRetry={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.getByText("Please try again.")).toBeInTheDocument();
  });
});

describe("passkeys", () => {
  it("converts base64url text both ways", () => {
    const bytes = new Uint8Array([251, 255, 254, 0, 1, 2]);
    const text = toBase64Url(bytes.buffer);
    expect(text).toBe("-__-AAEC");
    expect(Array.from(new Uint8Array(fromBase64Url(text)))).toEqual(Array.from(bytes));
  });

  it("lists the passkeys and removes one", async () => {
    const calls = mockApi({
      "GET /phone/me": { body: ME },
      "DELETE /phone/passkeys/k-1": { status: 204 },
    });
    const user = userEvent.setup();
    renderRoute("/phone/passkey");
    expect(await screen.findByText("Your passkeys: 1 of 3")).toBeInTheDocument();
    const item = screen.getByText("Chrome on Android").closest("li") as HTMLElement;
    await user.click(within(item).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(calls.some((call) => call.method === "DELETE")).toBe(true));
  });
});

describe("phone menu", () => {
  it("signs out and returns to the sign-in page", async () => {
    const calls = mockApi({
      "GET /phone/me": { body: ME },
      "POST /phone/logout": { status: 204 },
    });
    const user = userEvent.setup();
    const router = renderRoute("/phone");
    await screen.findByText("Hello, Sunita");
    await user.click(screen.getByRole("button", { name: "Menu" }));
    const menu = await screen.findByRole("dialog");
    expect(within(menu).getByText("Privacy notice")).toBeInTheDocument();
    await user.click(within(menu).getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/phone/login"));
    expect(calls.some((call) => call.path === "/phone/logout")).toBe(true);
  });

  it("asks before it stops phone punching", async () => {
    const calls = mockApi({
      "GET /phone/me": { body: ME },
      "POST /phone/stop": { status: 204 },
    });
    const user = userEvent.setup();
    const router = renderRoute("/phone");
    await screen.findByText("Hello, Sunita");
    await user.click(screen.getByRole("button", { name: "Menu" }));
    const menu = await screen.findByRole("dialog");
    await user.click(within(menu).getByRole("button", { name: "Stop phone punching" }));
    expect(
      within(menu).getByText(/You will not be able to punch with this phone/),
    ).toBeInTheDocument();
    expect(calls.some((call) => call.path === "/phone/stop")).toBe(false);
    await user.click(within(menu).getByRole("button", { name: "Stop phone punching" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/phone/login"));
    expect(calls.find((call) => call.path === "/phone/stop")?.body).toEqual({ confirm: true });
  });
});
