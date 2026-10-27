// The dashboard card "Cards ending soon" and the matching badge in the menu: Super Admin only.
import { screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockApi, SUPER_ADMIN } from "../../test/mock-api";
import { CORPORATE_HEAD, PLANT_HEAD, PLANT_K134, page } from "../../test/people-fixtures";
import { renderRoute } from "../../test/render";

const LAYOUT = {
  "GET /plants": page([PLANT_K134], 200),
  "GET /change-requests/pending-count": { body: { count: 0 } },
  "GET /health": { body: { status: "ok", version: "dev", server_time: "2026-10-20T10:00:00Z" } },
};

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("cards ending soon", () => {
  it("shows the Super Admin how many cards end soon, with a link to exactly those", async () => {
    mockApi({
      ...LAYOUT,
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /qr-cards/expiring-count": { body: { count: 12, days: 14 } },
    });

    renderRoute("/admin");

    expect(await screen.findByText("Cards ending soon")).toBeInTheDocument();
    expect(
      await screen.findByText("12 QR cards end in the next 14 days. Extend them or let them end."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See these cards" })).toHaveAttribute(
      "href",
      "/admin/qr-cards?state=expiring",
    );
  });

  it("speaks of one card in the singular", async () => {
    mockApi({
      ...LAYOUT,
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /qr-cards/expiring-count": { body: { count: 1, days: 14 } },
    });

    renderRoute("/admin");

    expect(
      await screen.findByText("1 QR card ends in the next 14 days. Extend it or let it end."),
    ).toBeInTheDocument();
  });

  it("puts the number in the menu next to QR cards for the Super Admin", async () => {
    mockApi({
      ...LAYOUT,
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /qr-cards/expiring-count": { body: { count: 12, days: 14 } },
    });

    renderRoute("/admin");

    const link = await screen.findByRole("link", { name: /QR cards/ });
    expect(await within(link).findByText("12")).toBeInTheDocument();
    expect(within(link).getByText("cards end soon")).toBeInTheDocument();
  });

  it("shows no badge when no card ends soon", async () => {
    mockApi({
      ...LAYOUT,
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /qr-cards/expiring-count": { body: { count: 0, days: 14 } },
    });

    renderRoute("/admin");

    const link = await screen.findByRole("link", { name: /QR cards/ });
    await screen.findByText("Cards ending soon");
    expect(within(link).queryByText("0")).not.toBeInTheDocument();
  });

  it.each([
    ["Corporate Head", CORPORATE_HEAD],
    ["Plant Head", PLANT_HEAD],
  ])(
    "shows a %s neither the card nor the badge, and never asks for the number",
    async (_name, me) => {
      const calls = mockApi({ ...LAYOUT, "GET /auth/me": { body: me } });

      renderRoute("/admin");

      await screen.findByRole("link", { name: "QR cards" });
      expect(screen.queryByText("Cards ending soon")).not.toBeInTheDocument();
      expect(calls.some((call) => call.path.includes("expiring-count"))).toBe(false);
    },
  );
});

// The dashboard card "Face enrolment" (spec M3 §4.13, F-40): every role, numbers from the server.
const PROGRESS = {
  plants: [
    {
      plant: { id: "p-1", code: "K134", name: "Sheet Shapers K-134" },
      face_employees: 60,
      enrolled: 52,
      not_enrolled: 8,
      old_model: 0,
      reenrol_suggested: 2,
    },
    {
      plant: { id: "p-2", code: "K135", name: "Sheet Shapers K-135" },
      face_employees: 30,
      enrolled: 8,
      not_enrolled: 22,
      old_model: 0,
      reenrol_suggested: 0,
    },
  ],
  totals: {
    face_employees: 90,
    enrolled: 60,
    not_enrolled: 30,
    old_model: 0,
    reenrol_suggested: 2,
  },
};

function health(state: string) {
  return {
    body: {
      status: "ok",
      version: "dev",
      server_time: "2026-10-20T10:00:00Z",
      face: { state, model_pack: "buffalo_s", antispoof_model: null },
    },
  };
}

describe("face enrolment card", () => {
  it("shows the totals, one row per plant and the links to the lists", async () => {
    mockApi({
      ...LAYOUT,
      "GET /health": health("ready"),
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /qr-cards/expiring-count": { body: { count: 0, days: 14 } },
      "GET /face/enrolment-progress": { body: PROGRESS },
    });

    renderRoute("/admin");

    expect(await screen.findByText("Face enrolment")).toBeInTheDocument();
    expect(await screen.findByText("of 90 enrolled")).toBeInTheDocument();
    expect(screen.getByText("67% · 30 not enrolled yet")).toBeInTheDocument();
    const rows = screen.getAllByRole("listitem");
    expect(rows.some((row) => within(row).queryByText("K135"))).toBe(true);
    expect(screen.getByRole("link", { name: /See employees not enrolled \(30\)/ })).toHaveAttribute(
      "href",
      "/admin/employees?face_state=not_enrolled",
    );
    expect(screen.getByRole("link", { name: /Re-enrol suggested/ })).toHaveAttribute(
      "href",
      "/admin/employees?face_state=reenrol_suggested",
    );
  });

  it("shows a Plant Head only their own plant, without a plant list", async () => {
    const single = { plants: [PROGRESS.plants[0]], totals: PROGRESS.plants[0] };
    mockApi({
      ...LAYOUT,
      "GET /health": health("ready"),
      "GET /auth/me": { body: PLANT_HEAD },
      "GET /face/enrolment-progress": { body: single },
    });

    renderRoute("/admin");

    expect(await screen.findByText("Face enrolment at K134")).toBeInTheDocument();
    expect(await screen.findByText("of 60 enrolled")).toBeInTheDocument();
    expect(screen.queryByText("Sheet Shapers K-134")).not.toBeInTheDocument();
  });

  it("says what to do first when nobody is enrolled yet", async () => {
    const empty = {
      plants: [{ ...PROGRESS.plants[0], enrolled: 0, not_enrolled: 60, reenrol_suggested: 0 }],
      totals: {
        ...PROGRESS.totals,
        enrolled: 0,
        face_employees: 60,
        not_enrolled: 60,
        reenrol_suggested: 0,
      },
    };
    mockApi({
      ...LAYOUT,
      "GET /health": health("ready"),
      "GET /auth/me": { body: CORPORATE_HEAD },
      "GET /face/enrolment-progress": { body: empty },
    });

    renderRoute("/admin");

    expect(await screen.findByText("Nobody is enrolled yet")).toBeInTheDocument();
    expect(screen.getByText("Take the 5 pictures.")).toBeInTheDocument();
  });

  it("says so when the face engine did not start", async () => {
    mockApi({
      ...LAYOUT,
      "GET /health": health("failed"),
      "GET /auth/me": { body: CORPORATE_HEAD },
      "GET /face/enrolment-progress": { body: PROGRESS },
    });

    renderRoute("/admin");

    expect(await screen.findByText(/The face engine did not start/)).toBeInTheDocument();
  });
});
