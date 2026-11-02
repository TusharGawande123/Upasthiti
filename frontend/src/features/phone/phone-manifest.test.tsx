// "Add to home screen" for the phone pages (M4b AC-52, F-74): /phone links the manifest, the
// manifest is limited to /phone and opens like an app, and the phone pages never register a
// service worker (the phone is online-only; the gate's worker is limited to /attendance).
import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import manifestText from "../../../public/phone.webmanifest?raw";
import viteConfigText from "../../../vite.config.ts?raw";
import { fakeGeolocation } from "../../test/fake-geolocation";
import { mockApi } from "../../test/mock-api";
import { renderRoute } from "../../test/render";

beforeEach(() => {
  // A phone browser: a camera and a location reading exist.
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia: vi.fn() },
    configurable: true,
  });
  Object.defineProperty(navigator, "geolocation", { value: fakeGeolocation, configurable: true });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("phone web app manifest", () => {
  it("is linked by /phone, has scope /phone and display standalone", async () => {
    mockApi({});
    renderRoute("/phone/login");
    await screen.findByLabelText("Employee code");

    expect(document.head.querySelector('link[rel="manifest"]')?.getAttribute("href")).toBe(
      "/phone.webmanifest",
    );
    const manifest = JSON.parse(manifestText);
    expect(manifest.scope).toBe("/phone");
    expect(manifest.start_url).toBe("/phone");
    expect(manifest.display).toBe("standalone");
  });

  it("registers no service worker for the phone pages", async () => {
    const register = vi.fn();
    Object.defineProperty(navigator, "serviceWorker", {
      value: { register },
      configurable: true,
    });
    mockApi({});
    renderRoute("/phone/login");
    await screen.findByLabelText("Employee code");

    expect(register).not.toHaveBeenCalled();
    Reflect.deleteProperty(navigator, "serviceWorker");
  });

  it("leaves the gate worker with its own scope /attendance", () => {
    const viteConfig = viteConfigText;
    expect(viteConfig).toContain('scope: "/attendance"');
    expect(viteConfig).not.toContain('scope: "/phone"');
  });
});
