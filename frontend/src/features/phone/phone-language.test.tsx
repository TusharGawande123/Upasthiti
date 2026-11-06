// The language switch of the /phone pages (F-99): the text changes, the notice is fetched in the
// chosen language, the choice is remembered, and everything outside /phone stays English.
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18n from "i18next";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import hindiTexts from "../../../public/locales/hi/common.json";
import marathiTexts from "../../../public/locales/mr/common.json";
import { fakeGeolocation } from "../../test/fake-geolocation";
import { mockApi } from "../../test/mock-api";
import { renderRoute } from "../../test/render";
import { readStoredPhoneLanguage, startingLanguage } from "./phone-language";

const STORAGE_KEY = "upasthiti.phone.language";

beforeAll(async () => {
  // The app loads these files over HTTP; the tests put them in directly.
  i18n.addResourceBundle("mr", "common", marathiTexts, true, true);
  i18n.addResourceBundle("hi", "common", hindiTexts, true, true);
  // The phone pages are loaded lazily; load them once now so no test waits for the first load.
  await Promise.all([
    import("./phone-layout"),
    import("./phone-login-page"),
    import("./phone-notice-page"),
  ]);
}, 60_000);

beforeEach(async () => {
  // A phone browser: the sign-in page needs a camera and a location reading to exist.
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia: vi.fn() },
    configurable: true,
  });
  Object.defineProperty(navigator, "geolocation", { value: fakeGeolocation, configurable: true });
  window.localStorage.clear();
  await i18n.changeLanguage("en");
});
afterEach(async () => {
  window.localStorage.clear();
  await i18n.changeLanguage("en");
});

const NOTICE_ANSWER = (language: string) => ({
  body: {
    version: "phone-notice-v2",
    language,
    text: `Notice text in ${language}`,
    text_sha256: "c".repeat(64),
  },
});

describe("phone language switch", () => {
  it("shows the phone sign-in page in Marathi and Hindi after a tap", async () => {
    mockApi({});
    const user = userEvent.setup();
    renderRoute("/phone/login");
    expect(await screen.findByLabelText("Employee code")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "मराठी" }));
    expect(await screen.findByLabelText("कर्मचारी कोड")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "मराठी" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "हिंदी" }));
    expect(await screen.findByText("फ़ोन से हाज़िरी")).toBeInTheDocument();
    expect(screen.queryByText("फोनवरील हजेरी")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "EN" }));
    expect(await screen.findByLabelText("Employee code")).toBeInTheDocument();
  });

  it("remembers the choice, also when the storage is blocked", async () => {
    mockApi({});
    const user = userEvent.setup();
    renderRoute("/phone/login");
    await user.click(await screen.findByRole("button", { name: "हिंदी" }));

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("hi");
    expect(readStoredPhoneLanguage()).toBe("hi");
    expect(startingLanguage("/phone/login")).toBe("hi");
    expect(startingLanguage("/admin/employees")).toBe("en");
    expect(startingLanguage("/attendance")).toBe("en");

    const blocked = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("blocked");
      },
      configurable: true,
    });
    try {
      expect(readStoredPhoneLanguage()).toBe("en");
    } finally {
      if (blocked) Object.defineProperty(window, "localStorage", blocked);
    }
  });

  it("opens the next visit in the remembered language", async () => {
    window.localStorage.setItem(STORAGE_KEY, "mr");
    mockApi({});
    renderRoute("/phone/login");

    expect(await screen.findByLabelText("कर्मचारी कोड")).toBeInTheDocument();
  });

  it("ignores a remembered value that is not one of the three languages", async () => {
    window.localStorage.setItem(STORAGE_KEY, "fr");
    mockApi({});
    renderRoute("/phone/login");

    expect(await screen.findByLabelText("Employee code")).toBeInTheDocument();
  });

  it("fetches the notice in the chosen language and sends that language with I agree", async () => {
    const calls = mockApi({
      "GET /phone/me": {
        body: {
          employee: { code: "E1", name: "Sunita", first_name: "Sunita", plant: { name: "P" } },
          access: {},
          notice: { required: true, version: "phone-notice-v2" },
          passkeys: [],
        },
      },
      "GET /phone/notice": (call) =>
        NOTICE_ANSWER(new URL(`http://x${call.path}`).searchParams.get("language") ?? "?"),
      "POST /phone/notice/accept": { status: 201, body: { accepted_at: "2026-11-05T04:30:00Z" } },
    });
    const user = userEvent.setup();
    renderRoute("/phone/notice");
    await screen.findByText("Notice text in en");

    await user.click(screen.getByRole("button", { name: "मराठी" }));
    await screen.findByText("Notice text in mr");
    expect(calls.some((call) => call.path === "/phone/notice?language=mr")).toBe(true);

    await user.click(await screen.findByRole("button", { name: "मी सहमत आहे" }));
    await waitFor(() =>
      expect(calls.find((call) => call.path === "/phone/notice/accept")?.body).toEqual({
        version: "phone-notice-v2",
        text_sha256: "c".repeat(64),
        language: "mr",
      }),
    );
  });

  it("keeps the admin login page in English whatever was chosen for the phone", async () => {
    window.localStorage.setItem(STORAGE_KEY, "mr");
    mockApi({ "GET /auth/me": { status: 401, body: { error: { code: "NOT_SIGNED_IN" } } } });
    renderRoute("/admin/login");

    expect(await screen.findByRole("button", { name: "Log in" })).toBeInTheDocument();
    expect(i18n.language).toBe("en");
  });
});
