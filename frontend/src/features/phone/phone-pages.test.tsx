// The phone pages (M4b P4): sign in, session ended, notice, password rules, home, my attendance and
// the punch result texts. Dates are pinned so the tests do not depend on the day they run.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-client";
import { fakeGeolocation, fakeReading, resetFakeReading } from "../../test/fake-geolocation";
import { apiError, mockApi } from "../../test/mock-api";
import { renderRoute } from "../../test/render";
import { PhoneLocationError } from "./phone-camera-hooks";
import { passwordRules } from "./phone-password-page";
import { codeOfFailure, lookFor } from "./phone-problems";

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
  passkeys: [],
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

function setBrowser(mediaDevices: unknown) {
  Object.defineProperty(navigator, "mediaDevices", { value: mediaDevices, configurable: true });
  Object.defineProperty(navigator, "geolocation", { value: fakeGeolocation, configurable: true });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-02T04:30:00Z"));
  // A phone browser: a camera and a location reading exist.
  setBrowser({ getUserMedia: vi.fn() });
  resetFakeReading();
  // A real browser answers a little later, never inside the call (the shared fake answers at once).
  fakeGeolocation.watchPosition.mockImplementation((success: PositionCallback) => {
    setTimeout(() => {
      success({
        coords: {
          latitude: fakeReading.latitude,
          longitude: fakeReading.longitude,
          accuracy: fakeReading.accuracy,
        },
        timestamp: Date.now(),
      } as GeolocationPosition);
    }, 0);
    return 1;
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("phone sign in", () => {
  it("signs in and opens the home page", async () => {
    const calls = mockApi({
      "POST /phone/login": { body: { employee: ME.employee, notice_required: false } },
      "GET /phone/me": { body: ME },
    });
    const user = userEvent.setup();
    const router = renderRoute("/phone/login");
    await user.type(await screen.findByLabelText("Employee code"), "e0412");
    await user.type(screen.getByLabelText("Password"), "Correct-Horse-42");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/phone"));
    // The code is sent in capitals, as typed on a phone keyboard.
    expect(calls.find((call) => call.path === "/phone/login")?.body).toEqual({
      employee_code: "E0412",
      password: "Correct-Horse-42",
    });
    expect(await screen.findByText("Hello, Sunita")).toBeInTheDocument();
    // The top bar (created on the sign-in page) must show the new session: name and Menu button.
    expect(await screen.findByRole("button", { name: "Menu" })).toBeInTheDocument();
    expect(screen.getByText(/Sunita Jadhav ·/)).toBeInTheDocument();
  });

  it("shows one wrong-password text and says how long a locked account waits", async () => {
    mockApi({
      "POST /phone/login": apiError(423, "PHONE_ACCOUNT_LOCKED", { minutes_left: 14 }),
    });
    const user = userEvent.setup();
    renderRoute("/phone/login");
    await user.type(await screen.findByLabelText("Employee code"), "E1");
    await user.type(screen.getByLabelText("Password"), "x");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many wrong passwords. Try again in 14 minutes, or reset your password.",
    );
    expect(screen.getByRole("button", { name: "Sign in" })).toBeDisabled();
  });

  it("goes to the notice when the server asks for it", async () => {
    mockApi({
      "POST /phone/login": { body: { employee: ME.employee, notice_required: true } },
      "GET /phone/me": { body: { ...ME, notice: { required: true, version: "1" } } },
      "GET /phone/notice": {
        body: {
          version: "1",
          language: "en",
          text: "We use your location.",
          text_sha256: "a".repeat(64),
        },
      },
    });
    const user = userEvent.setup();
    const router = renderRoute("/phone/login");
    await user.type(await screen.findByLabelText("Employee code"), "E0412");
    await user.type(screen.getByLabelText("Password"), "pw");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/phone/notice"));
    expect(await screen.findByText("We use your location.")).toBeInTheDocument();
  });

  it("asks for a supported browser when there is no camera", async () => {
    setBrowser(undefined);
    mockApi({});
    renderRoute("/phone/login");
    expect(
      await screen.findByText("Please open this page in Chrome or Edge on your phone."),
    ).toBeInTheDocument();
  });
});

describe("a signed-in page without a session", () => {
  it.each([
    ["new_login", "You signed in on another phone, so this phone was signed out."],
    ["expired", "Please sign in again."],
  ])("sends the person to sign in with the reason %s", async (ended, text) => {
    mockApi({ "GET /phone/me": apiError(401, "PHONE_NOT_SIGNED_IN", { ended }) });
    const router = renderRoute("/phone");
    await waitFor(() => expect(router.state.location.pathname).toBe("/phone/login"));
    expect(await screen.findByRole("alert")).toHaveTextContent(text);
  });

  it("says phone punching is off when the office switched it off", async () => {
    mockApi({ "GET /phone/me": apiError(403, "PHONE_PUNCH_OFF") });
    const router = renderRoute("/phone");
    await waitFor(() => expect(router.state.location.pathname).toBe("/phone/login"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Phone attendance is switched off for you. Please visit the plant office.",
    );
  });
});

describe("phone home", () => {
  it("shows the greeting, today's punch, the outside work badge and the face button", async () => {
    mockApi({
      "GET /phone/me": {
        body: {
          ...ME,
          access: { outside_work_allowed: true, outside_work_until: "2026-11-03" },
          today: {
            last_punch: { direction: "in", time: "2026-11-02T01:32:00Z", channel: "kiosk" },
          },
        },
      },
    });
    renderRoute("/phone");
    expect(await screen.findByText("Hello, Sunita")).toBeInTheDocument();
    expect(screen.getByText("IN at 07:02")).toBeInTheDocument();
    expect(screen.getByText("Attendance device")).toBeInTheDocument();
    expect(screen.getByText("Outside work allowed")).toBeInTheDocument();
    expect(screen.getByText("until 03/11/2026")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Punch with face" })).toHaveAttribute(
      "href",
      "/phone/punch/face",
    );
    expect(await screen.findByText("Location ready")).toBeInTheDocument();
  });

  it("offers the phone code scan to a card worker and no button when the face is not ready", async () => {
    mockApi({
      "GET /phone/me": {
        body: { ...ME, employee: { ...ME.employee, punch_method: "qr" } },
      },
    });
    renderRoute("/phone");
    expect(
      await screen.findByRole("link", { name: "Scan the phone code at the gate" }),
    ).toHaveAttribute("href", "/phone/punch/gate-code");
  });

  it("shows the not-ready text instead of the punch button", async () => {
    mockApi({ "GET /phone/me": { body: { ...ME, ready: { face: false } } } });
    renderRoute("/phone");
    expect(
      await screen.findByText(
        "Your face is not set up for attendance. Please visit the plant office.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Punch with face" })).not.toBeInTheDocument();
  });

  it("tells a person without exact location to move outside", async () => {
    mockApi({ "GET /phone/me": { body: ME } });
    fakeReading.accuracy = 80;
    renderRoute("/phone");
    expect(
      await screen.findByText(
        "Location not exact enough (80 m). Move outside, where the sky is open.",
        {},
        { timeout: 15_000 },
      ),
    ).toBeInTheDocument();
  }, 20_000);
});

describe("phone notice", () => {
  it("sends the hash of the text it showed when the person agrees", async () => {
    const calls = mockApi({
      "GET /phone/me": { body: { ...ME, notice: { required: true, version: "1" } } },
      "GET /phone/notice": {
        body: { version: "1", language: "en", text: "The notice.", text_sha256: "b".repeat(64) },
      },
      "POST /phone/notice/accept": { status: 201, body: { accepted_at: "2026-11-02T04:30:00Z" } },
    });
    const user = userEvent.setup();
    renderRoute("/phone/notice");
    await screen.findByText("The notice.");
    await user.click(screen.getByRole("button", { name: "I agree" }));
    await waitFor(() =>
      expect(calls.find((call) => call.path === "/phone/notice/accept")?.body).toEqual({
        version: "1",
        text_sha256: "b".repeat(64),
        language: "en",
      }),
    );
  });
});

describe("my attendance", () => {
  it("lists days with status, times and the word per punch", async () => {
    mockApi({
      "GET /phone/me": { body: ME },
      "GET /phone/attendance": {
        body: {
          days: [
            {
              date: "2026-11-02",
              status: "incomplete",
              first_in: "2026-11-02T01:32:00Z",
              last_out: null,
              worked_min: 0,
              channels: ["phone"],
            },
            {
              date: "2026-11-01",
              status: "weekly_off",
              first_in: null,
              last_out: null,
              worked_min: 0,
              channels: [],
            },
            {
              date: "2026-10-30",
              status: "present",
              first_in: "2026-10-30T01:30:00Z",
              last_out: "2026-10-30T13:35:00Z",
              worked_min: 725,
              channels: ["kiosk"],
            },
          ],
        },
      },
    });
    renderRoute("/phone/attendance");
    expect(await screen.findByText("Monday 02/11/2026")).toBeInTheDocument();
    expect(screen.getByText("Open")).toBeInTheDocument();
    expect(screen.getByText("Weekly off")).toBeInTheDocument();
    const friday = screen.getByText("Friday 30/10/2026").closest("li") as HTMLElement;
    expect(within(friday).getByText("12 h 5 m")).toBeInTheDocument();
    expect(within(friday).getByText("Attendance device")).toBeInTheDocument();
    expect(screen.getByText("Something wrong? Please visit the plant office.")).toBeInTheDocument();
  });

  it("says so when there is nothing yet", async () => {
    mockApi({ "GET /phone/me": { body: ME }, "GET /phone/attendance": { body: { days: [] } } });
    renderRoute("/phone/attendance");
    expect(await screen.findByText("No attendance yet in the last 31 days.")).toBeInTheDocument();
  });
});

describe("password rules and problem texts", () => {
  it("ticks the four rules", () => {
    expect(passwordRules("abc", "E0412")).toEqual({
      length: false,
      notOnlyNumbers: true,
      notCode: true,
      notEasy: true,
    });
    expect(passwordRules("12345678", "E0412")).toMatchObject({
      length: true,
      notOnlyNumbers: false,
      notEasy: false,
    });
    expect(passwordRules("e0412", "E0412").notCode).toBe(false);
    expect(Object.values(passwordRules("Good-Pass-77", "E0412")).every(Boolean)).toBe(true);
  });

  it("chooses a look for every code and turns failures into codes", () => {
    expect(lookFor("LIVENESS_FAILED")).toMatchObject({ retry: true, tone: "amber" });
    expect(lookFor("OUTSIDE_GEOFENCE")).toMatchObject({ retry: false, tone: "red" });
    expect(lookFor("COOLDOWN_ACTIVE")).toMatchObject({ retry: false, tone: "grey" });
    expect(lookFor("SOMETHING_NEW").code).toBe("INTERNAL_ERROR");
    expect(codeOfFailure(new ApiError("NETWORK_ERROR", "", 0))).toBe("NETWORK_OFFLINE");
    expect(codeOfFailure(new PhoneLocationError("PHONE_LOCATION_DENIED"))).toBe(
      "PHONE_LOCATION_DENIED",
    );
    expect(codeOfFailure(new Error("CHALLENGE_EXPIRED"))).toBe("CHALLENGE_EXPIRED");
  });
});
