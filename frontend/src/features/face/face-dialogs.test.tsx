// The withdraw-consent and delete-face-data dialogs: the reason rules, success, refusal, cancel.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiError, mockApi } from "../../test/mock-api";
import { DeleteFaceDataDialog, WithdrawConsentDialog } from "./face-dialogs";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

afterEach(() => vi.unstubAllGlobals());

const EMPLOYEE = { id: "e-1", name: "Asha Rao" };

function show(node: React.ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>);
}

describe("withdraw consent dialog", () => {
  it("sends the pre-filled reason and closes", async () => {
    const calls = mockApi({
      "POST /employees/e-1/face/consent/withdraw": { status: 204 },
    });
    const onClose = vi.fn();
    show(<WithdrawConsentDialog employee={EMPLOYEE} onClose={onClose} />);
    const user = userEvent.setup();
    const reason = (await screen.findByLabelText(/reason/i)) as HTMLTextAreaElement;
    expect(reason.value.length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: /withdraw/i }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(calls.find((call) => call.method === "POST")?.body).toMatchObject({
      reason: reason.value,
    });
  });

  it("sends no reason when it is emptied, shows a refusal and cancels", async () => {
    const calls = mockApi({
      "POST /employees/e-1/face/consent/withdraw": apiError(403, "FORBIDDEN"),
    });
    const onClose = vi.fn();
    show(<WithdrawConsentDialog employee={EMPLOYEE} onClose={onClose} />);
    const user = userEvent.setup();
    await user.clear(await screen.findByLabelText(/reason/i));
    await user.click(screen.getByRole("button", { name: /withdraw/i }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({ reason: null });
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("delete face data dialog", () => {
  it("needs a reason, then deletes and closes", async () => {
    const calls = mockApi({ "POST /employees/e-1/face/template/delete": { status: 204 } });
    const onClose = vi.fn();
    show(<DeleteFaceDataDialog employee={EMPLOYEE} onClose={onClose} />);
    const user = userEvent.setup();
    const submit = await screen.findByRole("button", { name: /delete/i });
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText("Reason"), "Asked to be removed");
    await user.click(submit);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({
      reason: "Asked to be removed",
    });
  });

  it("shows a refusal and cancels", async () => {
    mockApi({ "POST /employees/e-1/face/template/delete": apiError(404, "NOT_FOUND") });
    const onClose = vi.fn();
    show(<DeleteFaceDataDialog employee={EMPLOYEE} onClose={onClose} />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Reason"), "Duplicate");
    await user.click(screen.getByRole("button", { name: /delete/i }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });
});
