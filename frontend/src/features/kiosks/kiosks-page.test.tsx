// Admin kiosks: the list with icon+word statuses, adding a kiosk (code shown once, QR, paired
// result), "geofence first", revoking with a reason, and what a Corporate Head may do.
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiError, mockApi, SUPER_ADMIN } from "../../test/mock-api";
import { renderRoute } from "../../test/render";

const CORPORATE_HEAD = { ...SUPER_ADMIN, id: "u-2", role: "corporate_head" };

const PLANT = {
  id: "p-1",
  name: "Sheet Shapers (K-134)",
  code: "K134",
  address: "",
  lat: null,
  lon: null,
  is_active: true,
  geofence_set: true,
  active_kiosks: 1,
  active_employees: 0,
};
const NO_GEOFENCE_PLANT = {
  ...PLANT,
  id: "p-2",
  code: "PC1",
  name: "Precise Cuts",
  geofence_set: false,
};

function kiosk(overrides: Record<string, unknown>) {
  return {
    id: "k-1",
    plant_id: "p-1",
    name: "Main gate phone",
    status: "active",
    registered_at: "2026-10-12T05:00:00Z",
    registered_accuracy_m: "18.0",
    last_seen_at: "2026-10-13T04:00:00Z",
    app_version: "dev",
    revoked_at: null,
    revoke_reason: null,
    ...overrides,
  };
}

function plantsPage(items: unknown[]) {
  return { body: { items, page: 1, page_size: 200, total: items.length } };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("kiosks list", () => {
  it("shows every status as an icon plus a word, with the accuracy at pairing", async () => {
    mockApi({
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /plants": plantsPage([PLANT]),
      "GET /kiosks": {
        body: [
          kiosk({}),
          kiosk({
            id: "k-2",
            name: "Spare tablet",
            status: "pending",
            registered_accuracy_m: null,
            last_seen_at: null,
          }),
          kiosk({
            id: "k-3",
            name: "Old phone",
            status: "revoked",
            revoke_reason: "Lost",
            revoked_at: "2026-10-10T00:00:00Z",
          }),
        ],
      },
    });

    renderRoute("/admin/kiosks");

    const active = (await screen.findByText("Main gate phone")).closest("tr") as HTMLElement;
    expect(within(active).getByText("Active")).toBeInTheDocument();
    expect(within(active).getByText("± 18 m")).toBeInTheDocument();
    const pending = screen.getByText("Spare tablet").closest("tr") as HTMLElement;
    expect(within(pending).getByText("Waiting for pairing")).toBeInTheDocument();
    expect(within(pending).getByText("Never")).toBeInTheDocument();
    const revoked = screen.getByText("Old phone").closest("tr") as HTMLElement;
    expect(within(revoked).getByText("Revoked")).toBeInTheDocument();
    expect(within(revoked).getByText("Lost")).toBeInTheDocument();
    expect(within(revoked).queryByRole("button", { name: "Revoke" })).not.toBeInTheDocument();
  });

  it("shows a helpful empty state", async () => {
    mockApi({
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /plants": plantsPage([PLANT]),
      "GET /kiosks": { body: [] },
    });

    renderRoute("/admin/kiosks");

    expect(await screen.findByText("No kiosks yet")).toBeInTheDocument();
  });

  it("lets a Corporate Head view but not change kiosks", async () => {
    mockApi({
      "GET /auth/me": { body: CORPORATE_HEAD },
      "GET /plants": plantsPage([PLANT]),
      "GET /kiosks": { body: [kiosk({})] },
    });

    renderRoute("/admin/kiosks");

    await screen.findByText("Main gate phone");
    expect(screen.queryByRole("button", { name: "Add kiosk" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Revoke" })).not.toBeInTheDocument();
  });

  it("revokes a kiosk with a reason", async () => {
    const calls = mockApi({
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /plants": plantsPage([PLANT]),
      "GET /kiosks": { body: [kiosk({})] },
      "POST /kiosks/k-1/revoke": { body: kiosk({ status: "revoked" }) },
    });
    const user = userEvent.setup();

    renderRoute("/admin/kiosks");
    await user.click(await screen.findByRole("button", { name: "Revoke" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Reason"), "Phone lost");
    await user.click(within(dialog).getByRole("button", { name: "Revoke" }));

    await vi.waitFor(() =>
      expect(calls.find((call) => call.path === "/kiosks/k-1/revoke")?.body).toEqual({
        reason: "Phone lost",
      }),
    );
  });
});

describe("add kiosk", () => {
  // The kiosk list as the server answers it after the kiosk was created.
  function createFlow(listedStatus: "pending" | "active") {
    const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    let created = false;
    const calls = mockApi({
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /plants": plantsPage([PLANT]),
      "GET /kiosks": () => ({
        body: created ? [kiosk({ id: "k-9", name: "Main gate tablet", status: listedStatus })] : [],
      }),
      "POST /kiosks": () => {
        created = true;
        return {
          status: 201,
          body: {
            kiosk: kiosk({ id: "k-9", name: "Main gate tablet", status: "pending" }),
            pairing_code: "482913",
            code_expires_at: expires,
          },
        };
      },
    });
    return calls;
  }

  async function addKiosk() {
    const user = userEvent.setup();
    renderRoute("/admin/kiosks");
    await user.click(await screen.findByRole("button", { name: "Add kiosk" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Kiosk name"), "Main gate tablet");
    await user.click(within(dialog).getByRole("button", { name: "Make pairing code" }));
  }

  it("creates the kiosk and shows the code with a QR while waiting for the device", async () => {
    const calls = createFlow("pending");

    await addKiosk();

    const qr = await screen.findByAltText(/QR code that opens the pairing page/);
    expect(qr).toHaveAttribute("src", "/api/v1/kiosks/k-9/pairing-qr.svg?code=482913");
    expect(screen.getByRole("img", { name: "4 8 2 9 1 3" })).toBeInTheDocument();
    expect(screen.getByText("Waiting for the device…")).toBeInTheDocument();
    expect(calls.find((call) => call.path === "/kiosks" && call.method === "POST")?.body).toEqual({
      plant_id: "p-1",
      name: "Main gate tablet",
    });
  });

  it("says the kiosk is paired as soon as the list shows it active", async () => {
    createFlow("active");

    await addKiosk();

    expect(await screen.findByText("Main gate tablet is paired")).toBeInTheDocument();
    expect(screen.queryByAltText(/QR code/)).not.toBeInTheDocument();
  });

  it("asks for a geofence first when the plant has none", async () => {
    mockApi({
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /plants": plantsPage([NO_GEOFENCE_PLANT]),
      "GET /kiosks": { body: [] },
      "POST /kiosks": apiError(422, "GEOFENCE_NOT_SET"),
    });
    const user = userEvent.setup();

    renderRoute("/admin/kiosks");
    await user.click(await screen.findByRole("button", { name: "Add kiosk" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Kiosk name"), "Gate");
    await user.click(within(dialog).getByRole("button", { name: "Make pairing code" }));

    expect(await within(dialog).findByText(/This plant has no geofence yet/)).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "Draw the geofence" })).toHaveAttribute(
      "href",
      "/admin/plants/p-2",
    );
  });

  it("makes a new code for a kiosk that is waiting", async () => {
    const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    mockApi({
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /plants": plantsPage([PLANT]),
      "GET /kiosks": { body: [kiosk({ id: "k-2", name: "Spare tablet", status: "pending" })] },
      "POST /kiosks/k-2/pairing-code": {
        body: {
          kiosk: kiosk({ id: "k-2", name: "Spare tablet", status: "pending" }),
          pairing_code: "135790",
          code_expires_at: expires,
        },
      },
    });
    const user = userEvent.setup();

    renderRoute("/admin/kiosks");
    await user.click(await screen.findByRole("button", { name: "New code" }));

    expect(await screen.findByRole("img", { name: "1 3 5 7 9 0" })).toBeInTheDocument();
    expect(screen.getByText(/The code works once, for 10 minutes/)).toBeInTheDocument();
  });
});
