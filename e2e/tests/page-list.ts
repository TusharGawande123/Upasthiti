// Every page (route) of the website, with the person who may open it. responsive.spec.ts measures
// each one at 360 px and 768 px and scans it with axe; the Vitest guard
// frontend/src/app/router-page-list.test.ts fails when a route of router.tsx is missing here
// (M6 AC-M6-27). A new page is added to this list in the same commit that adds the route.

export type PageRole = "anonymous" | "super" | "corporate" | "plant" | "phone";

/** Pages whose address holds an id: the spec makes a plant or an employee and fills it in. */
export type PageParameter = "plantId" | "employeeId";

export type PageEntry = {
  /** The route exactly as router.tsx writes it (the guard compares these texts). */
  route: string;
  role: PageRole;
  /** Set when the route has a ":something" in it. */
  parameter?: PageParameter;
  /** The address to open when it differs from the route (an unknown address, for "*"). */
  open?: string;
  /**
   * Pages that need a phone employee's signed-in session cannot be opened cheaply here; the named
   * spec file measures them after a real sign-in with a painted camera.
   */
  measuredIn?: string;
  /** Redirects and pages that show no heading until something is typed or clicked. */
  noHeading?: boolean;
};

export const ADMIN_PAGE_LIST: PageEntry[] = [
  { route: "/admin", role: "super" },
  { route: "/admin/setup", role: "super" },
  { route: "/admin/plants", role: "super" },
  { route: "/admin/plants/:plantId", role: "super", parameter: "plantId" },
  { route: "/admin/kiosks", role: "super" },
  { route: "/admin/employees", role: "super" },
  { route: "/admin/employees/new", role: "super" },
  { route: "/admin/employees/:employeeId", role: "super", parameter: "employeeId" },
  { route: "/admin/employees/:employeeId/edit", role: "super", parameter: "employeeId" },
  { route: "/admin/import", role: "super" },
  { route: "/admin/notices", role: "super" },
  { route: "/admin/punches", role: "super" },
  { route: "/admin/muster", role: "super" },
  { route: "/admin/attendance", role: "super" },
  { route: "/admin/attendance/register", role: "super" },
  { route: "/admin/corrections", role: "super" },
  { route: "/admin/leave", role: "super" },
  { route: "/admin/holidays", role: "super" },
  { route: "/admin/review", role: "super" },
  { route: "/admin/qr-cards", role: "super" },
  { route: "/admin/contractors", role: "super" },
  { route: "/admin/approvals", role: "super" },
  { route: "/admin/my-requests", role: "corporate" },
  { route: "/admin/users", role: "super" },
  { route: "/admin/reports", role: "super" },
  { route: "/admin/insights/punctuality", role: "super" },
  { route: "/admin/notifications", role: "super" },
  { route: "/admin/settings", role: "super" },
  { route: "/admin/audit", role: "super" },
  { route: "/admin/privacy-requests", role: "super" },
  { route: "/admin/data-export", role: "super" },
  { route: "/admin/sessions", role: "super" },
];

export const OTHER_PAGE_LIST: PageEntry[] = [
  { route: "/admin/login", role: "anonymous" },
  { route: "/admin/new-password", role: "anonymous", noHeading: true },
  { route: "/attendance", role: "anonymous" },
  { route: "/privacy", role: "anonymous" },
  { route: "/phone/login", role: "anonymous" },
  { route: "/phone/setup", role: "anonymous" },
  { route: "/phone/setup/password", role: "anonymous", noHeading: true },
  { route: "/phone", role: "phone", measuredIn: "phone-punch.spec.ts" },
  { route: "/phone/notice", role: "phone", measuredIn: "phone-punch.spec.ts" },
  { route: "/phone/attendance", role: "phone", measuredIn: "phone-punch.spec.ts" },
  { route: "/phone/passkey", role: "phone", measuredIn: "phone-punch.spec.ts" },
  { route: "/phone/punch/face", role: "phone", measuredIn: "phone-punch.spec.ts" },
  { route: "/phone/punch/gate-code", role: "phone", measuredIn: "phone-punch.spec.ts" },
  // Redirects and the page for an unknown address.
  { route: "/", role: "anonymous", noHeading: true },
  { route: "/kiosk", role: "anonymous", noHeading: true },
  { route: "*", role: "anonymous", open: "/no-such-page" },
];

export const PAGE_LIST: PageEntry[] = [...ADMIN_PAGE_LIST, ...OTHER_PAGE_LIST];
