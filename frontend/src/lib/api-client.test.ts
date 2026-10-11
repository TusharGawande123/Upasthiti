import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiGet } from "./api-client";

function mockFetch(implementation: () => Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(implementation));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiGet", () => {
  it("calls the relative /api/v1 path and returns the JSON body", async () => {
    mockFetch(async () => Response.json({ status: "ok" }));

    await expect(apiGet("/health")).resolves.toEqual({ status: "ok" });
    expect(fetch).toHaveBeenCalledWith("/api/v1/health", expect.anything());
  });

  it("turns the standard error format into an ApiError with its code", async () => {
    const body = { error: { code: "DATABASE_UNAVAILABLE", message: "Down", details: {} } };
    mockFetch(async () => Response.json(body, { status: 503 }));

    const error = await apiGet("/health/ready").catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: "DATABASE_UNAVAILABLE", status: 503 });
  });

  it("uses HTTP_ERROR when the body is not our format", async () => {
    mockFetch(async () => new Response("Bad gateway", { status: 502 }));

    await expect(apiGet("/health")).rejects.toMatchObject({ code: "HTTP_ERROR", status: 502 });
  });

  it("uses NETWORK_ERROR when the server cannot be reached", async () => {
    mockFetch(async () => {
      throw new TypeError("Failed to fetch");
    });

    await expect(apiGet("/health")).rejects.toMatchObject({ code: "NETWORK_ERROR", status: 0 });
  });
});
