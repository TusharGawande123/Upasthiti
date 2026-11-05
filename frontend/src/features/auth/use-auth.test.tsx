// Logging out removes everything the screens had loaded (M6 gap test for M5 AC-28): the muster list
// of the plant must not stay in memory for the next person at the same computer.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { mockApi } from "../../test/mock-api";
import { useLogout } from "./use-auth";

describe("log out", () => {
  it("removes the saved muster list and every other loaded answer", async () => {
    mockApi({ "POST /auth/logout": { status: 204 } });
    const queryClient = new QueryClient();
    queryClient.setQueryData(["muster", "p-1"], { people: [{ code: "1043" }] });
    queryClient.setQueryData(["dashboard", "live"], { arrived: 4 });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useLogout(), { wrapper });
    result.current.mutate();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.getQueryData(["muster", "p-1"])).toBeUndefined();
    expect(queryClient.getQueryData(["dashboard", "live"])).toBeUndefined();
  });
});
