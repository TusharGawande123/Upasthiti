// Showing a card PDF: the new tab is opened first (so the browser does not block it), a blocked
// pop-up falls back to a download, and a failure closes the empty tab again.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openPdfInNewTab } from "./use-qr-cards";

const FILE = new Blob(["%PDF-1.7"], { type: "application/pdf" });

beforeEach(() => {
  vi.useFakeTimers();
  URL.createObjectURL = vi.fn(() => "blob:fake-address");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("openPdfInNewTab", () => {
  it("opens the tab before the file arrives and points it at the file", async () => {
    const tab = { location: { href: "" }, close: vi.fn() };
    const open = vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    const order: string[] = [];
    open.mockImplementation(() => {
      order.push("tab opened");
      return tab as unknown as Window;
    });

    await openPdfInNewTab(async () => {
      order.push("file requested");
      return FILE;
    }, "card-C000123.pdf");

    expect(order).toEqual(["tab opened", "file requested"]);
    expect(tab.location.href).toBe("blob:fake-address");
  });

  it("downloads the file when the browser blocks the new tab", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    const clicked: { download: string; href: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push({ download: this.download, href: this.href });
    });

    await openPdfInNewTab(async () => FILE, "card-C000123.pdf");

    expect(clicked).toEqual([{ download: "card-C000123.pdf", href: "blob:fake-address" }]);
  });

  it("closes the empty tab and passes the error on when the file cannot be made", async () => {
    const tab = { location: { href: "" }, close: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);

    await expect(
      openPdfInNewTab(async () => {
        throw new Error("QR_CARD_REVOKED");
      }, "x.pdf"),
    ).rejects.toThrow("QR_CARD_REVOKED");

    expect(tab.close).toHaveBeenCalledOnce();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("drops the address of the file after a minute", async () => {
    vi.spyOn(window, "open").mockReturnValue({
      location: { href: "" },
      close: vi.fn(),
    } as unknown as Window);

    await openPdfInNewTab(async () => FILE, "x.pdf");
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);

    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fake-address");
  });
});
