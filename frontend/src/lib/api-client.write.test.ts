// The write methods of the API client: JSON bodies, empty answers and the "please log in" hook.
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiDelete, apiPost, setNotAuthenticatedHandler } from "./api-client";

afterEach(() => {
  vi.unstubAllGlobals();
  setNotAuthenticatedHandler(null);
});

describe("api client writes", () => {
  it("sends a JSON body and reads the JSON answer", async () => {
    const fetchMock = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await apiPost<{ ok: boolean }>("/things", { name: "x" });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/things",
      expect.objectContaining({
        method: "POST",
        body: '{"name":"x"}',
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
      }),
    );
  });

  it("accepts an empty 204 answer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 })),
    );

    await expect(apiDelete("/things/1")).resolves.toBeUndefined();
  });

  it("calls the login hook when the session ended, and still throws the error", async () => {
    const handler = vi.fn();
    setNotAuthenticatedHandler(handler);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: { code: "NOT_AUTHENTICATED", message: "Please log in.", details: {} } },
          { status: 401 },
        ),
      ),
    );

    await expect(apiPost("/things")).rejects.toBeInstanceOf(ApiError);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
