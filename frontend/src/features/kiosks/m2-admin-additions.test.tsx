// The M2 additions to existing admin screens (design gate C): the sound switch and last self-test
// on the kiosks list and a plant's kiosks tab, the new and now-editable settings, and the gate
// poster button on the plant page (spec M2 §4.12, §5.5; F-1, F-27, F-34; AC-25, AC-36).
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockApi, SUPER_ADMIN } from "../../test/mock-api";
import { CORPORATE_HEAD, PLANT_HEAD, PLANT_K134, page } from "../../test/people-fixtures";
import { renderRoute } from "../../test/render";

const KIOSK = {
  id: "k-1",
  plant_id: "p-1",
  name: "K134 main gate",
  status: "active",
  registered_at: "2026-10-12T05:00:00Z",
  registered_accuracy_m: "18.0",
  last_seen_at: "2026-10-20T04:00:00Z",
  app_version: "dev",
  revoked_at: null,
  revoke_reason: null,
  sound_muted: false,
  last_self_test_at: "2026-10-20T02:28:00Z", // 07:58 IST
};
const MUTED = {
  ...KIOSK,
  id: "k-2",
  name: "X280 gate",
  sound_muted: true,
  last_self_test_at: null,
};
const PENDING = {
  ...KIOSK,
  id: "k-3",
  name: "Spare tablet",
  status: "pending",
  sound_muted: false,
};
const REVOKED = {
  ...KIOSK,
  id: "k-4",
  name: "Old phone",
  status: "revoked",
  revoke_reason: "Lost",
};

function kioskAnswers(me: unknown, kiosks: unknown[] = [KIOSK, MUTED, PENDING, REVOKED]) {
  return {
    "GET /auth/me": { body: me },
    "GET /plants": page([PLANT_K134], 200),
    "GET /kiosks": { body: kiosks },
    "GET /change-requests/pending-count": { body: { count: 0 } },
    "GET /qr-cards/expiring-count": { body: { count: 0 } },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("kiosks list: sound and self-test", () => {
  it("shows when each gate was last tested and its sound, in words", async () => {
    mockApi(kioskAnswers(SUPER_ADMIN));

    renderRoute("/admin/kiosks");

    const main = (await screen.findByText("K134 main gate")).closest("tr") as HTMLElement;
    expect(within(main).getByText("20/10/2026 07:58")).toBeInTheDocument();
    expect(within(main).getByText("On")).toBeInTheDocument();
    const quiet = screen.getByText("X280 gate").closest("tr") as HTMLElement;
    expect(within(quiet).getByText("Never tested")).toBeInTheDocument();
    expect(within(quiet).getByText("Off")).toBeInTheDocument();
    // A kiosk that is not paired, or switched off for good, has no test and no sound switch.
    const revoked = screen.getByText("Old phone").closest("tr") as HTMLElement;
    expect(within(revoked).queryByRole("switch")).not.toBeInTheDocument();
  });

  it("lets the Super Admin switch a gate's sound off, sending only that field", async () => {
    const calls = mockApi({
      ...kioskAnswers(SUPER_ADMIN),
      "PATCH /kiosks/k-1": { body: { ...KIOSK, sound_muted: true } },
    });
    const user = userEvent.setup();
    renderRoute("/admin/kiosks");

    const toggle = await screen.findByRole("switch", { name: "Sound at K134 main gate" });
    expect(toggle).toBeChecked();
    await user.click(toggle);

    await waitFor(() => expect(calls.some((call) => call.method === "PATCH")).toBe(true));
    expect(calls.find((call) => call.method === "PATCH")?.body).toEqual({ sound_muted: true });
  });

  it("switches a muted gate back on", async () => {
    const calls = mockApi({
      ...kioskAnswers(SUPER_ADMIN),
      "PATCH /kiosks/k-2": { body: { ...MUTED, sound_muted: false } },
    });
    const user = userEvent.setup();
    renderRoute("/admin/kiosks");

    await user.click(await screen.findByRole("switch", { name: "Sound at X280 gate" }));

    await waitFor(() =>
      expect(calls.find((call) => call.method === "PATCH")?.body).toEqual({ sound_muted: false }),
    );
  });

  it("gives a Plant Head the sound switch", async () => {
    mockApi(kioskAnswers(PLANT_HEAD));
    renderRoute("/admin/kiosks");
    expect(await screen.findAllByRole("switch")).not.toHaveLength(0);
  });

  it("shows the Corporate Head the sound as words without a switch", async () => {
    mockApi(kioskAnswers(CORPORATE_HEAD));

    renderRoute("/admin/kiosks");

    await screen.findByText("K134 main gate");
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.getAllByText("Off").length).toBeGreaterThan(0);
  });
});

describe("settings: M2 cards", () => {
  const setting = (key: string, group: string, value: number | string, extra = {}) => ({
    key,
    group,
    value,
    default: value,
    unit: "",
    used_from: 2,
    editable: true,
    minimum: null,
    maximum: null,
    allowed_values: null,
    ...extra,
  });
  const SETTINGS = {
    settings: [
      setting("snapshot_retention_days", "snapshots", 60, {
        unit: "days",
        minimum: 7,
        maximum: 365,
      }),
      setting("qr_card_default_validity_months", "cards", 2, {
        unit: "months",
        minimum: 1,
        maximum: 36,
      }),
      setting("kiosk_voice_enabled", "kiosk_screen", "on", { allowed_values: ["on", "off"] }),
      setting("kiosk_result_seconds", "kiosk_screen", 4, { unit: "s", minimum: 2, maximum: 10 }),
      setting("salary_day_basis", "salary", 30, {
        used_from: 7,
        editable: false,
        allowed_values: [26, 30, "actual"],
      }),
    ],
  };

  it("shows the QR cards and the kiosk sound and screen cards with their settings", async () => {
    mockApi({ "GET /auth/me": { body: SUPER_ADMIN }, "GET /settings": { body: SETTINGS } });

    renderRoute("/admin/settings");

    expect(await screen.findByText("Device sound and screen")).toBeInTheDocument();
    expect(screen.getByText("ID cards of temporary workers.")).toBeInTheDocument();
    expect(screen.getByLabelText("Default card validity")).toHaveValue("2");
    expect(screen.getByLabelText("Result screen time")).not.toHaveAttribute("readonly");
  });

  it("shows on / off settings as a choice and sends the word", async () => {
    const calls = mockApi({
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /settings": { body: SETTINGS },
      "PUT /settings": { body: SETTINGS },
    });
    const user = userEvent.setup();
    renderRoute("/admin/settings");

    await user.selectOptions(await screen.findByLabelText("Voice"), "Off");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await user.type(await screen.findByLabelText("Reason"), "Gate is next to an office");
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Save changes" }),
    );

    await waitFor(() => expect(calls.some((call) => call.method === "PUT")).toBe(true));
    expect(calls.find((call) => call.method === "PUT")?.body).toMatchObject({
      values: { kiosk_voice_enabled: "off" },
    });
  });

  it("warns that lowering the retention also shortens the photos already stored", async () => {
    mockApi({ "GET /auth/me": { body: SUPER_ADMIN }, "GET /settings": { body: SETTINGS } });
    const user = userEvent.setup();
    renderRoute("/admin/settings");
    const field = await screen.findByLabelText("Snapshot retention");
    expect(screen.queryByText(/also shortens the photos already stored/)).not.toBeInTheDocument();

    await user.clear(field);
    await user.type(field, "30");

    expect(
      screen.getByText("Lowering to 30 days also shortens the photos already stored."),
    ).toBeInTheDocument();
    expect(screen.getByText(/deleted tonight at 00:05 IST/)).toBeInTheDocument();
    // Raising it again takes the warning away.
    await user.clear(field);
    await user.type(field, "90");
    expect(screen.queryByText(/also shortens the photos already stored/)).not.toBeInTheDocument();
  });

  it("keeps Save off for a number outside the range", async () => {
    mockApi({ "GET /auth/me": { body: SUPER_ADMIN }, "GET /settings": { body: SETTINGS } });
    renderRoute("/admin/settings");

    fireEvent.change(await screen.findByLabelText("Result screen time"), {
      target: { value: "30" },
    });

    expect(screen.getByText("Use a value from 2 to 10.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  it("shows a locked choice setting (salary days) read-only", async () => {
    mockApi({ "GET /auth/me": { body: SUPER_ADMIN }, "GET /settings": { body: SETTINGS } });

    renderRoute("/admin/settings");

    expect(await screen.findByLabelText("Salary day basis")).toHaveAttribute("readonly");
  });
});

describe("gate poster button", () => {
  const K134 = {
    ...PLANT_K134,
    address: "",
    lat: null,
    lon: null,
    is_active: true,
    geofence_set: true,
    active_kiosks: 1,
    active_employees: 0,
  };
  const READINESS = {
    plant_id: "p-1",
    ready: true,
    checks: [],
  };

  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => "blob:fake-poster");
    URL.revokeObjectURL = vi.fn();
  });

  function plantAnswers(me: unknown) {
    return {
      ...kioskAnswers(me, []),
      "GET /plants/p-1": { body: K134 },
      "GET /plants/p-1/readiness": { body: READINESS },
      "GET /plants/p-1/gate-poster.pdf": { body: {} },
    };
  }

  it("opens the poster PDF for the Super Admin", async () => {
    const tab = { location: { href: "" }, close: vi.fn() };
    vi.stubGlobal(
      "open",
      vi.fn(() => tab),
    );
    const calls = mockApi(plantAnswers(SUPER_ADMIN));
    const user = userEvent.setup();
    renderRoute("/admin/plants/p-1");

    await user.click(await screen.findByRole("button", { name: "Download gate poster (A4 PDF)" }));

    await waitFor(() => expect(tab.location.href).toBe("blob:fake-poster"));
    expect(calls.some((call) => call.path === "/plants/p-1/gate-poster.pdf")).toBe(true);
  });

  it("is there for a Plant Head too, but not for the Corporate Head", async () => {
    mockApi(plantAnswers(PLANT_HEAD));
    const first = renderRoute("/admin/plants/p-1");
    expect(
      await screen.findByRole("button", { name: "Download gate poster (A4 PDF)" }),
    ).toBeInTheDocument();
    first.dispose();
  });

  it("is not offered to the Corporate Head", async () => {
    mockApi(plantAnswers(CORPORATE_HEAD));

    renderRoute("/admin/plants/p-1");

    await screen.findByRole("heading", { name: PLANT_K134.name });
    expect(
      screen.queryByRole("button", { name: "Download gate poster (A4 PDF)" }),
    ).not.toBeInTheDocument();
  });
});
