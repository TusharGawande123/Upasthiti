// The Reports screen (/admin/reports): the seven cards, the address of every download per kind,
// the saved file name, the plant lock of a Plant Head and every refusal in words.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiError, mockApi, SUPER_ADMIN } from "../../test/mock-api";
import { CORPORATE_HEAD, PLANT_HEAD, PLANT_K134, page } from "../../test/people-fixtures";
import { renderRoute } from "../../test/render";
import { daysBetween, REPORTS, reportAddress } from "./use-reports";

type Download = { path: string };

// The report files are not JSON, so this wraps the fake backend: every /reports/ call is
// answered by `answer`, everything else by the normal fake answers.
function stubReports(
  me: unknown,
  answer: (path: string) => Response = () =>
    new Response("file", {
      headers: { "Content-Disposition": 'attachment; filename="upasthiti-test-ALL-2026-10.xlsx"' },
    }),
) {
  mockApi({
    "GET /auth/me": { body: me },
    "GET /plants": page([PLANT_K134], 200),
    "GET /contractors": { body: [{ id: "c-1", name: "Shree Staffing", is_active: true }] },
  });
  const normal = globalThis.fetch;
  const downloads: Download[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (!String(url).includes("/reports/")) return normal(url, init);
      const path = String(url).replace("/api/v1", "");
      downloads.push({ path });
      return answer(path);
    }),
  );
  return downloads;
}

function card(title: string) {
  return screen.getByRole("heading", { name: title }).closest("div.flex-col") as HTMLElement;
}

let saved: string[] = [];

beforeEach(() => {
  localStorage.clear();
  saved = [];
  URL.createObjectURL = vi.fn(() => "blob:report");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    saved.push(this.download);
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("report addresses", () => {
  const choice = {
    day: "2026-10-30",
    month: "2026-10",
    dateFrom: "2026-10-01",
    dateTo: "2026-10-31",
    plantId: "p-1",
    contractorId: "c-1",
    includeDemo: false,
  };
  const config = (kind: string) =>
    REPORTS.find((item) => item.kind === kind) as (typeof REPORTS)[0];

  it("uses date for a day, month for a month and date_from and date_to for a range", () => {
    expect(reportAddress(config("daily-muster"), "pdf", choice)).toBe(
      "/reports/daily-muster.pdf?date=2026-10-30&plant_id=p-1",
    );
    expect(reportAddress(config("register"), "xlsx", choice)).toBe(
      "/reports/register.xlsx?month=2026-10&plant_id=p-1",
    );
    expect(reportAddress(config("exceptions"), "xlsx", choice)).toBe(
      "/reports/exceptions.xlsx?date_from=2026-10-01&date_to=2026-10-31&plant_id=p-1",
    );
  });

  it("sends the contractor only for contractor hours, and demo only when on", () => {
    expect(reportAddress(config("contractor-hours"), "xlsx", choice)).toContain(
      "contractor_id=c-1",
    );
    expect(reportAddress(config("register"), "xlsx", choice)).not.toContain("contractor_id");
    expect(reportAddress(config("register"), "xlsx", { ...choice, includeDemo: true })).toContain(
      "include_demo=true",
    );
  });

  it("counts both days of a range", () => {
    expect(daysBetween("2026-10-01", "2026-10-31")).toBe(31);
    expect(daysBetween("2026-10-01", "2026-11-01")).toBe(32);
  });
});

describe("the reports page", () => {
  it("shows the three limits and the seven reports", async () => {
    stubReports(SUPER_ADMIN);

    renderRoute("/admin/reports");

    expect(await screen.findByText("One file at a time")).toBeInTheDocument();
    expect(screen.getByText("20 files in 10 minutes")).toBeInTheDocument();
    for (const title of [
      "Daily muster",
      "Monthly register",
      "Contractor hours",
      "Late, early and overtime",
      "Exceptions",
      "Rejected punches",
      "Corrections",
    ]) {
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    }
    expect(screen.getAllByRole("button", { name: "Excel" })).toHaveLength(7);
  });

  it("asks for the Excel file of a month and saves it under the server's name", async () => {
    const downloads = stubReports(SUPER_ADMIN);
    const user = userEvent.setup();

    renderRoute("/admin/reports");
    await screen.findByText("One file at a time");
    await user.click(within(card("Monthly register")).getByRole("button", { name: "Excel" }));

    await waitFor(() => expect(saved).toEqual(["upasthiti-test-ALL-2026-10.xlsx"]));
    expect(downloads[0]?.path).toMatch(/^\/reports\/register\.xlsx\?month=\d{4}-\d{2}$/);
    expect(
      await within(card("Monthly register")).findByText(
        "Downloaded upasthiti-test-ALL-2026-10.xlsx",
      ),
    ).toBeInTheDocument();
  });

  it("sends the chosen plant and contractor for contractor hours as PDF", async () => {
    const downloads = stubReports(SUPER_ADMIN);
    const user = userEvent.setup();

    renderRoute("/admin/reports");
    await screen.findByText("One file at a time");
    const hours = card("Contractor hours");
    await within(hours).findByRole("option", { name: "Shree Staffing" });
    await user.selectOptions(within(hours).getByLabelText("Plant"), "p-1");
    await user.selectOptions(within(hours).getByLabelText("Contractor"), "c-1");
    await user.click(within(hours).getByRole("button", { name: "PDF" }));

    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(downloads[0]?.path).toContain("/reports/contractor-hours.pdf?");
    expect(downloads[0]?.path).toContain("plant_id=p-1");
    expect(downloads[0]?.path).toContain("contractor_id=c-1");
  });

  it("refuses a range over 31 days in the card and disables its buttons", async () => {
    const downloads = stubReports(SUPER_ADMIN);

    renderRoute("/admin/reports");
    await screen.findByText("One file at a time");
    const exceptions = card("Exceptions");
    fireEvent.change(within(exceptions).getByLabelText("From"), {
      target: { value: "2026-08-01" },
    });
    fireEvent.change(within(exceptions).getByLabelText("To"), { target: { value: "2026-09-15" } });

    expect(within(exceptions).getByText(/That is 46 days/)).toBeInTheDocument();
    expect(within(exceptions).getByRole("button", { name: "Excel" })).toBeDisabled();
    expect(within(exceptions).getByRole("button", { name: "PDF" })).toBeDisabled();
    expect(downloads).toHaveLength(0);
  });

  it("says a PDF is too large and suggests Excel or one plant", async () => {
    stubReports(SUPER_ADMIN, () =>
      Response.json(apiError(422, "REPORT_TOO_LARGE").body, { status: 422 }),
    );
    const user = userEvent.setup();

    renderRoute("/admin/reports");
    await screen.findByText("One file at a time");
    await user.click(within(card("Monthly register")).getByRole("button", { name: "PDF" }));

    expect(
      await screen.findByText(
        /more than 3,000 rows\. Download the Excel file, or choose one plant/,
      ),
    ).toBeInTheDocument();
  });

  it("explains the busy and the 20-files refusals in words", async () => {
    let code = "REPORT_BUSY";
    stubReports(SUPER_ADMIN, () => Response.json(apiError(429, code).body, { status: 429 }));
    const user = userEvent.setup();

    renderRoute("/admin/reports");
    await screen.findByText("One file at a time");
    await user.click(within(card("Daily muster")).getByRole("button", { name: "Excel" }));
    expect(await screen.findByText(/Another report is still being built/)).toBeInTheDocument();

    code = "TOO_MANY_REQUESTS";
    await user.click(within(card("Daily muster")).getByRole("button", { name: "Excel" }));
    expect(
      await screen.findByText(/You have made 20 files in the last 10 minutes/),
    ).toBeInTheDocument();
  });

  it("locks the plant of a Plant Head and sends it", async () => {
    const downloads = stubReports(PLANT_HEAD);
    const user = userEvent.setup();

    renderRoute("/admin/reports");
    await screen.findByText("One file at a time");
    const muster = card("Daily muster");

    expect(await within(muster).findByText(/K134 · Sheet Shapers/)).toBeInTheDocument();
    expect(within(muster).queryByRole("combobox", { name: "Plant" })).not.toBeInTheDocument();
    await user.click(within(muster).getByRole("button", { name: "Excel" }));
    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(downloads[0]?.path).toContain("plant_id=p-1");
  });

  it("shows the demo switch to the Super Admin only", async () => {
    stubReports(CORPORATE_HEAD);

    renderRoute("/admin/reports");
    await screen.findByText("One file at a time");

    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });
});
