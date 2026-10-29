// The gate's service worker is registered only in a production build, only by the gate page and
// only for the scope /attendance (spec M4 §7 rule 13), and a failed registration never breaks the
// gate: it just cannot reload offline.
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerGateServiceWorker } from "./register-sw";

function fakeServiceWorker(register: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigator, "serviceWorker", { value: { register }, configurable: true });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "serviceWorker");
});

describe("registering the gate's service worker", () => {
  it("does nothing in development", () => {
    vi.stubEnv("PROD", false);
    const register = vi.fn().mockResolvedValue(undefined);
    fakeServiceWorker(register);

    registerGateServiceWorker();
    window.dispatchEvent(new Event("load"));

    expect(register).not.toHaveBeenCalled();
  });

  it("does nothing in a browser without service workers", () => {
    vi.stubEnv("PROD", true);
    const listen = vi.spyOn(window, "addEventListener");

    registerGateServiceWorker();

    expect(listen).not.toHaveBeenCalledWith("load", expect.anything(), expect.anything());
  });

  it("registers /sw.js with the scope /attendance once the page has loaded", () => {
    vi.stubEnv("PROD", true);
    const register = vi.fn().mockResolvedValue(undefined);
    fakeServiceWorker(register);

    registerGateServiceWorker();
    expect(register).not.toHaveBeenCalled(); // not before the page has loaded
    window.dispatchEvent(new Event("load"));

    expect(register).toHaveBeenCalledWith("/sw.js", { scope: "/attendance" });
  });

  it("swallows a failed registration", async () => {
    vi.stubEnv("PROD", true);
    const register = vi.fn().mockRejectedValue(new Error("blocked"));
    fakeServiceWorker(register);

    registerGateServiceWorker();
    window.dispatchEvent(new Event("load"));
    await Promise.resolve();

    expect(register).toHaveBeenCalledTimes(1); // and no unhandled rejection
  });
});
