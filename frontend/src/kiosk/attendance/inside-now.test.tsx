// The gate idle screen shows "Inside now: N" from the heartbeat answer (M5 F-28): a number only,
// and nothing at all when the server leaves it out (the setting is off).
import { render, renderHook, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockApi } from "../../test/mock-api";
import { createDeviceKey } from "../device-key";
import { forgetDevice, saveDevice } from "../device-store";
import { buildHeartbeat, emptyFacts } from "./heartbeat-report";
import { InsideNowChip } from "./top-bar";
import { useHeartbeat } from "./use-heartbeat";

const ME = {
  kiosk_id: "11111111-2222-3333-4444-555555555555",
  kiosk_name: "Main gate",
  status: "active",
  plant: { id: "p-1", name: "Sheet Shapers", code: "K134" },
  server_time: "2026-10-28T08:00:00Z",
  notices: [],
  kiosk_settings: {},
};

async function pair() {
  const key = await createDeviceKey();
  await saveDevice({
    privateKey: key.privateKey,
    publicKeySpki: key.publicKeySpki,
    paired: {
      kioskId: ME.kiosk_id,
      kioskName: "Main gate",
      plantId: "p-1",
      plantCode: "K134",
      plantName: "Sheet Shapers",
      accuracyM: 10,
    },
    counter: 0,
  });
}

beforeEach(async () => {
  await forgetDevice();
  vi.unstubAllGlobals();
});

describe("inside now at the gate", () => {
  it("shows the number and nothing else", () => {
    render(<InsideNowChip count={214} />);
    expect(screen.getByText("Inside now: 214")).toBeInTheDocument();
  });

  it("shows nothing when the setting is off", () => {
    const { container } = render(<InsideNowChip count={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("takes the number from the heartbeat answer", async () => {
    await pair();
    mockApi({ "POST /kiosk/heartbeat": { body: { ...ME, inside_now: 214 } } });
    const handlers = {
      onRevoked: vi.fn(),
      onUnpaired: vi.fn(),
      getReport: () => buildHeartbeat(emptyFacts()),
    };

    const { result } = renderHook(() => useHeartbeat(null, 0, handlers));

    await waitFor(() => expect(result.current.insideNow).toBe(214));
  });

  it("is null when the server does not send it", async () => {
    await pair();
    mockApi({ "POST /kiosk/heartbeat": { body: ME } });
    const handlers = {
      onRevoked: vi.fn(),
      onUnpaired: vi.fn(),
      getReport: () => buildHeartbeat(emptyFacts()),
    };

    const { result } = renderHook(() => useHeartbeat(null, 0, handlers));

    await waitFor(() => expect(result.current.serverOffsetMs).not.toBe(0));
    expect(result.current.insideNow).toBeNull();
  });
});
