// The Kiosks tab inside a plant: the list, the empty and error states, and the add button by role.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiError, mockApi, SUPER_ADMIN } from "../../test/mock-api";
import { PlantKiosksTab } from "./plant-kiosks-tab";

afterEach(() => {
  vi.unstubAllGlobals();
});

function kiosk(changes: Record<string, unknown>) {
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
    sound_muted: false,
    last_self_test_at: null,
    ...changes,
  };
}

function show(canManage: boolean) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PlantKiosksTab plantId="p-1" canManage={canManage} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("plant kiosks tab", () => {
  it("lists the plant's devices and lets a manager open the add dialog", async () => {
    mockApi({
      "GET /auth/me": { body: SUPER_ADMIN },
      "GET /plants": { body: { items: [], page: 1, page_size: 200, total: 0 } },
      "GET /kiosks": {
        body: [
          kiosk({}),
          kiosk({ id: "k-2", name: "Spare", status: "pending", last_seen_at: null }),
        ],
      },
    });
    show(true);
    expect(await screen.findByText("Main gate phone")).toBeInTheDocument();
    expect(screen.getByText("Spare")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: /add/i }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("shows the empty text and hides the add button for a viewer", async () => {
    mockApi({ "GET /kiosks": { body: [] } });
    show(false);
    expect(await screen.findByText(/no attendance device/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add/i })).toBeNull();
  });

  it("shows an error when the list fails", async () => {
    mockApi({ "GET /kiosks": apiError(500, "SERVER_ERROR") });
    show(false);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
