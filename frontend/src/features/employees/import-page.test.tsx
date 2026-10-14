// Excel import wizard: the dry-run report with errors (all or nothing), a clean file that is
// saved, a Corporate Head's file that is sent for approval, and files refused before upload.
import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiError, mockApi, SUPER_ADMIN } from "../../test/mock-api";
import { CORPORATE_HEAD, PLANT_K134, page } from "../../test/people-fixtures";
import { renderRoute } from "../../test/render";

const LAYOUT = {
  "GET /plants": page([PLANT_K134], 200),
  "GET /change-requests/pending-count": { body: { count: 0 } },
};

const excel = (name = "people.xlsx") =>
  new File(["x"], name, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

async function choose(file: File) {
  const input = await screen.findByLabelText("Choose an Excel file");
  fireEvent.change(input, { target: { files: [file] } });
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("import", () => {
  it("checks the file first and lists every wrong row; nothing can be saved", async () => {
    const calls = mockApi({
      ...LAYOUT,
      "GET /auth/me": { body: SUPER_ADMIN },
      "POST /employees/import": {
        body: {
          ok_rows: 2,
          error_rows: 2,
          errors: [
            { row: 5, column: "plant_code", code: "PLANT_NOT_FOUND", message: "x" },
            {
              row: 7,
              column: "employee_code",
              code: "EMPLOYEE_CODE_DUPLICATE_IN_FILE",
              message: "x",
            },
          ],
        },
      },
    });

    renderRoute("/admin/import");
    await choose(excel());

    expect(await screen.findByText("This plant code does not exist.")).toBeInTheDocument();
    expect(screen.getByText("This employee code appears twice in the file.")).toBeInTheDocument();
    expect(screen.getByText(/Nothing is saved until the file has zero errors/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Import/ })).not.toBeInTheDocument();
    expect(calls.find((call) => call.path.startsWith("/employees/import"))?.path).toContain(
      "dry_run=true",
    );
  });

  it("saves a clean file and reports how many were created", async () => {
    const calls = mockApi({
      ...LAYOUT,
      "GET /auth/me": { body: SUPER_ADMIN },
      "POST /employees/import": (call) =>
        call.path.includes("dry_run=true")
          ? { body: { ok_rows: 352, error_rows: 0, errors: [] } }
          : { body: { ok_rows: 352, error_rows: 0, errors: [], created: 352 } },
    });
    const user = userEvent.setup();

    renderRoute("/admin/import");
    await choose(excel());
    await user.click(await screen.findByRole("button", { name: "Import 352 employees" }));

    expect(await screen.findByRole("heading", { name: "352 created" })).toBeInTheDocument();
    expect(
      calls
        .filter((call) => call.path.startsWith("/employees/import"))
        .map((call) => call.path.includes("dry_run=false")),
    ).toEqual([false, true]);
  });

  it("sends the file for approval when a Corporate Head imports it", async () => {
    mockApi({
      ...LAYOUT,
      "GET /auth/me": { body: CORPORATE_HEAD },
      "POST /employees/import": (call) =>
        call.path.includes("dry_run=true")
          ? { body: { ok_rows: 352, error_rows: 0, errors: [] } }
          : {
              status: 202,
              body: { change_request_id: "r-1", status: "pending", summary: "Import 352" },
            },
    });
    const user = userEvent.setup();

    renderRoute("/admin/import");
    await choose(excel());
    await user.click(
      await screen.findByRole("button", { name: "Send 352 employees for approval" }),
    );

    expect(await screen.findByRole("heading", { name: /Sent for approval/ })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "My requests" }).length).toBeGreaterThan(0);
  });

  it("refuses a file that is not .xlsx or is too large, without uploading", async () => {
    const calls = mockApi({ ...LAYOUT, "GET /auth/me": { body: SUPER_ADMIN } });

    renderRoute("/admin/import");
    await choose(new File(["x"], "people.csv", { type: "text/csv" }));
    expect(await screen.findByText("This is not an Excel (.xlsx) file.")).toBeInTheDocument();

    const big = excel("big.xlsx");
    Object.defineProperty(big, "size", { value: 3 * 1024 * 1024 });
    await choose(big);
    expect(await screen.findByText("The file is larger than 2 MB.")).toBeInTheDocument();
    expect(calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("shows the server's message for a file that is not an employee file", async () => {
    mockApi({
      ...LAYOUT,
      "GET /auth/me": { body: SUPER_ADMIN },
      "POST /employees/import": apiError(422, "IMPORT_FILE_INVALID"),
    });

    renderRoute("/admin/import");
    await choose(excel());

    expect(await screen.findByText(/not a valid employee file/)).toBeInTheDocument();
    const card = screen
      .getByText("Drop the Excel file here, or press to choose")
      .closest("button") as HTMLElement;
    expect(within(card).getByText(/\.xlsx only/)).toBeInTheDocument();
  });
});
