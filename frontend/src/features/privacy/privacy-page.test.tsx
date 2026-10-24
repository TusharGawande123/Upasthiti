// The public privacy notice (SPDI Rule 4, spec M3 §8.1): no login, the facts of the consent text,
// the retention days and the contact from the settings.
import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockApi } from "../../test/mock-api";
import { renderRoute } from "../../test/render";

const NOTICE = {
  company_address: "Plot K-134, MIDC Waluj, Chhatrapati Sambhajinagar",
  privacy_contact: "Asha Rao, Super Admin, privacy@sheetshapers.example",
  retention_days: 45,
  consent_version: "face-consent-v1",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the privacy notice page", () => {
  it("opens without a login and shows the facts, the days and the contact", async () => {
    const calls = mockApi({ "GET /privacy-notice": { body: NOTICE } });

    renderRoute("/privacy");

    expect(
      await screen.findByRole("heading", { name: "Face and photo attendance at Sheet Shapers" }),
    ).toBeInTheDocument();
    expect(await screen.findByText(/Version face-consent-v1/)).toBeInTheDocument();
    expect(screen.getAllByText(/Plot K-134, MIDC Waluj/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("45 days", { selector: "dd" })).toHaveLength(2); // photos of failed and card punches
    expect(screen.getByText(NOTICE.privacy_contact)).toBeInTheDocument();
    expect(screen.getByText(/never sent to any AI company/)).toBeInTheDocument();
    // Only the notice is asked for: no login check, no admin data.
    expect(calls.map((call) => call.path)).toEqual(["/privacy-notice"]);
  });

  it("says the contact is being set up while the setting is empty", async () => {
    mockApi({ "GET /privacy-notice": { body: { ...NOTICE, privacy_contact: "" } } });

    renderRoute("/privacy");

    expect(
      await screen.findByText("The contact is being set up. Until then, ask at your plant office."),
    ).toBeInTheDocument();
  });

  it("tells the reader when the notice could not be loaded", async () => {
    mockApi({
      "GET /privacy-notice": {
        status: 500,
        body: { error: { code: "INTERNAL_ERROR", message: "x", details: {} } },
      },
    });

    renderRoute("/privacy");

    expect(await screen.findByText(/The notice could not be loaded/)).toBeInTheDocument();
  });
});
