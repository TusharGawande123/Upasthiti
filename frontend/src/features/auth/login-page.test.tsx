// The login screen: success, wrong password, locked account and the new-password rules.
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiError, mockApi, SUPER_ADMIN } from "../../test/mock-api";
import { renderRoute } from "../../test/render";
import { passwordRuleResults } from "./new-password-page";

afterEach(() => {
  vi.unstubAllGlobals();
});

async function fillAndSubmit(login: string, password: string) {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Username or email"), login);
  await user.type(screen.getByLabelText("Password"), password);
  await user.click(screen.getByRole("button", { name: "Log in" }));
}

describe("login screen (spec AC-2)", () => {
  it("logs in and opens the dashboard", async () => {
    const calls = mockApi({
      "GET /auth/me": apiError(401, "NOT_AUTHENTICATED"),
      "POST /auth/login": { body: SUPER_ADMIN },
      "GET /health": { hang: true },
    });

    const router = renderRoute("/admin/login");
    await fillAndSubmit("tushar", "Correct-Horse-42");

    await waitFor(() => expect(router.state.location.pathname).toBe("/admin"));
    expect(calls.find((call) => call.path === "/auth/login")?.body).toEqual({
      login: "tushar",
      password: "Correct-Horse-42",
    });
  });

  it("shows one message for a wrong password", async () => {
    mockApi({
      "GET /auth/me": apiError(401, "NOT_AUTHENTICATED"),
      "POST /auth/login": apiError(401, "INVALID_CREDENTIALS"),
    });

    renderRoute("/admin/login");
    await fillAndSubmit("tushar", "wrong");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Username/email or password is wrong.",
    );
  });

  it("says how many minutes a locked account stays locked and turns the button off", async () => {
    mockApi({
      "GET /auth/me": apiError(401, "NOT_AUTHENTICATED"),
      "POST /auth/login": apiError(423, "ACCOUNT_LOCKED", { minutes_left: 14 }),
    });

    renderRoute("/admin/login");
    await fillAndSubmit("tushar", "wrong");

    expect(await screen.findByRole("alert")).toHaveTextContent("Try again in 14 min.");
    expect(screen.getByRole("button", { name: "Log in" })).toBeDisabled();
  });

  it("asks for both fields before sending anything", async () => {
    const calls = mockApi({ "GET /auth/me": apiError(401, "NOT_AUTHENTICATED") });

    renderRoute("/admin/login");
    await userEvent.click(await screen.findByRole("button", { name: "Log in" }));

    expect(await screen.findByText("Type your username or email.")).toBeInTheDocument();
    expect(calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("can show and hide the password", async () => {
    mockApi({ "GET /auth/me": apiError(401, "NOT_AUTHENTICATED") });

    renderRoute("/admin/login");
    const field = await screen.findByLabelText("Password");
    await userEvent.click(screen.getByRole("button", { name: "Show" }));

    expect(field).toHaveAttribute("type", "text");
  });
});

describe("password rules", () => {
  it("checks length, digits-only and the login name", () => {
    expect(passwordRuleResults("short", "tushar")).toMatchObject({ length: false });
    expect(passwordRuleResults("12345678901", "tushar")).toMatchObject({ notOnlyDigits: false });
    expect(passwordRuleResults("Tushar", "tushar")).toMatchObject({ notLoginName: false });
    expect(passwordRuleResults("Gate-Kiosk-2026!", "tushar")).toEqual({
      length: true,
      notOnlyDigits: true,
      notLoginName: true,
    });
  });
});
