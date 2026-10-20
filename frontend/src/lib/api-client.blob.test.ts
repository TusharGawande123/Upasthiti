// Downloading a file (a card PDF): the file comes back as a Blob, and an error answer is still
// the usual ApiError with its code and details.
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiBlob, setNotAuthenticatedHandler } from "./api-client";

afterEach(() => {
  vi.unstubAllGlobals();
  setNotAuthenticatedHandler(null);
});

describe("api client files", () => {
  it("asks for a PDF and returns the file", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response("%PDF-1.7", { status: 200, headers: { "Content-Type": "application/pdf" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const file = await apiBlob("/qr-cards/c-1/card.pdf", { method: "GET" });

    expect(await file.text()).toBe("%PDF-1.7");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/qr-cards/c-1/card.pdf",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ Accept: "application/pdf" }),
      }),
    );
  });

  it("sends a JSON body when printing a list of cards", async () => {
    const fetchMock = vi.fn(async () => new Response("%PDF-1.7"));
    vi.stubGlobal("fetch", fetchMock);

    await apiBlob("/qr-cards/print", { method: "POST", body: { card_ids: ["c-1"] } });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/qr-cards/print",
      expect.objectContaining({
        method: "POST",
        body: '{"card_ids":["c-1"]}',
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
      }),
    );
  });

  it("turns an error answer into an ApiError with its details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: { code: "QR_CARD_REVOKED", message: "x", details: { serials: ["C000067"] } } },
          { status: 409 },
        ),
      ),
    );

    const failure = await apiBlob("/qr-cards/print", { method: "POST", body: {} }).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).code).toBe("QR_CARD_REVOKED");
    expect((failure as ApiError).details).toEqual({ serials: ["C000067"] });
  });

  it("sends the user to the login screen when the session ended", async () => {
    const onNotAuthenticated = vi.fn();
    setNotAuthenticatedHandler(onNotAuthenticated);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error: { code: "NOT_AUTHENTICATED", message: "x" } }, { status: 401 }),
      ),
    );

    await expect(apiBlob("/qr-cards/c-1/card.pdf", { method: "GET" })).rejects.toBeInstanceOf(
      ApiError,
    );

    expect(onNotAuthenticated).toHaveBeenCalledOnce();
  });

  it("reports a missing connection as NETWORK_ERROR", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("offline");
      }),
    );

    await expect(apiBlob("/qr-cards/c-1/card.pdf", { method: "GET" })).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });
  });
});
