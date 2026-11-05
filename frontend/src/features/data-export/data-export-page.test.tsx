// The full data export page (/admin/data-export, M6 spec 4.2): the warning, the reason and password
// fields, the download and the error states. All data is invented.
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiError, mockApi, SUPER_ADMIN } from "../../test/mock-api";
import { renderRoute } from "../../test/render";
import { posts } from "../../test/review-fixtures";

const RECENT = [
  {
    at: "2026-11-04T05:30:00Z",
    actor_name: "Tushar Gawande",
    status: "done",
    size_bytes: 2_621_440,
    row_count: 1234,
    reason: "Employee asked to see her data",
  },
];

function base(extra: Record<string, unknown> = {}) {
  return {
    "GET /auth/me": { body: SUPER_ADMIN },
    "GET /exports/recent": { body: RECENT },
    ...extra,
  } as Parameters<typeof mockApi>[0];
}

async function fillForm(reason = "Employee asked to see her data", password = "Secret-Pass-1") {
  await userEvent.type(await screen.findByLabelText(/^Reason/), reason);
  await userEvent.type(screen.getByLabelText("Your password"), password);
}

beforeEach(() => {
  localStorage.clear();
  URL.createObjectURL = vi.fn(() => "blob:export");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => vi.unstubAllGlobals());

describe("the export page", () => {
  it("warns about personal data and lists what is never included", async () => {
    mockApi(base());

    renderRoute("/admin/data-export");

    expect(
      await screen.findByText(/This file has personal data\. Keep it safe/),
    ).toBeInTheDocument();
    expect(screen.getByText("Face data and enrolment pictures")).toBeInTheDocument();
    expect(screen.getByText("Passwords and passkeys")).toBeInTheDocument();
    expect(await screen.findByText("2.5 MB")).toBeInTheDocument();
  });

  it("keeps the button off until a reason and the password are typed", async () => {
    mockApi(base());
    renderRoute("/admin/data-export");
    const button = await screen.findByRole("button", { name: "Download all data" });
    expect(button).toBeDisabled();

    await fillForm();

    expect(button).toBeEnabled();
  });

  it("sends the reason and password and saves the ZIP", async () => {
    const calls = mockApi(base({ "POST /exports/full": { body: {} } }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    renderRoute("/admin/data-export");
    await fillForm();

    await userEvent.click(screen.getByRole("button", { name: "Download all data" }));

    await waitFor(() => expect(posts(calls)).toHaveLength(1));
    expect(posts(calls)[0]?.body).toEqual({
      reason: "Employee asked to see her data",
      password: "Secret-Pass-1",
    });
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(await screen.findByLabelText("Your password")).toHaveValue("");
    click.mockRestore();
  });

  it("shows the preparing message while the file is built", async () => {
    mockApi(base({ "POST /exports/full": { hang: true } }));
    renderRoute("/admin/data-export");
    await fillForm();

    await userEvent.click(screen.getByRole("button", { name: "Download all data" }));

    expect(await screen.findByText(/this can take a few minutes/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preparing..." })).toBeDisabled();
  });

  it.each([
    ["EXPORT_PASSWORD_WRONG", 403, "The password is not correct. Nothing was downloaded."],
    [
      "EXPORT_IN_PROGRESS",
      409,
      "An export is already being prepared. Please try again in a few minutes.",
    ],
    [
      "EXPORT_NO_SPACE",
      503,
      "There is not enough space on the server to prepare the export. Please try again later or ask for help.",
    ],
    ["TOO_MANY_REQUESTS", 429, "Too many tries. Please wait a little and try again."],
  ])("shows the words for %s and clears the password", async (code, status, words) => {
    mockApi(base({ "POST /exports/full": apiError(status, code) }));
    renderRoute("/admin/data-export");
    await fillForm();

    await userEvent.click(screen.getByRole("button", { name: "Download all data" }));

    expect(await screen.findByText(words)).toBeInTheDocument();
    expect(screen.getByLabelText("Your password")).toHaveValue("");
    expect(screen.getByLabelText(/^Reason/)).toHaveValue("Employee asked to see her data");
  });

  it("says when no export was made yet", async () => {
    mockApi(base({ "GET /exports/recent": { body: [] } }));

    renderRoute("/admin/data-export");

    expect(await screen.findByText("No export has been made yet.")).toBeInTheDocument();
  });
});
