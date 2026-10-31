// All page addresses of the website. One app, two areas: /admin (dashboard) and /attendance (gate).
//
// Every page is loaded only when it is first opened ("lazy"), so the gate kiosk never downloads
// the admin screens, and the admin never downloads the kiosk's camera and QR decoder (S-28).
import { createBrowserRouter, Navigate, type RouteObject, useLocation } from "react-router";
import { NotFoundPage } from "./not-found-page";

type LazyRoute = NonNullable<RouteObject["lazy"]>;

// The gate page was first at /kiosk: old printed QR codes and saved links keep working.
function OldGateAddress() {
  const { search } = useLocation();
  return <Navigate to={{ pathname: "/attendance", search }} replace />;
}

function BlankWhileLoading() {
  return null;
}

// `pick` names the page component inside the loaded file (pages use named exports).
function page<Module>(
  load: () => Promise<Module>,
  pick: (loaded: Module) => React.ComponentType,
): LazyRoute {
  return async () => ({ Component: pick(await load()) });
}

const adminPages: RouteObject[] = [
  {
    path: "/admin",
    lazy: page(
      () => import("../features/admin/dashboard-page"),
      (m) => m.DashboardPage,
    ),
  },
  {
    path: "/admin/setup",
    lazy: page(
      () => import("../features/plants/setup-wizard-page"),
      (m) => m.SetupWizardPage,
    ),
  },
  {
    path: "/admin/plants",
    lazy: page(
      () => import("../features/plants/plants-page"),
      (m) => m.PlantsPage,
    ),
  },
  {
    path: "/admin/plants/:plantId",
    lazy: page(
      () => import("../features/plants/plant-detail-page"),
      (m) => m.PlantDetailPage,
    ),
  },
  {
    path: "/admin/kiosks",
    lazy: page(
      () => import("../features/kiosks/kiosks-page"),
      (m) => m.KiosksPage,
    ),
  },
  {
    path: "/admin/employees",
    lazy: page(
      () => import("../features/employees/employees-page"),
      (m) => m.EmployeesPage,
    ),
  },
  {
    path: "/admin/employees/new",
    lazy: page(
      () => import("../features/employees/employee-form-page"),
      (m) => m.EmployeeFormPage,
    ),
  },
  {
    path: "/admin/employees/:employeeId",
    lazy: page(
      () => import("../features/employees/employee-detail-page"),
      (m) => m.EmployeeDetailPage,
    ),
  },
  {
    path: "/admin/employees/:employeeId/edit",
    lazy: page(
      () => import("../features/employees/employee-form-page"),
      (m) => m.EmployeeFormPage,
    ),
  },
  {
    path: "/admin/import",
    lazy: page(
      () => import("../features/employees/import-page"),
      (m) => m.ImportPage,
    ),
  },
  {
    path: "/admin/notices",
    lazy: page(
      () => import("../features/notices/notices-page"),
      (m) => m.NoticesPage,
    ),
  },
  {
    path: "/admin/punches",
    lazy: page(
      () => import("../features/punches/punches-page"),
      (m) => m.PunchesPage,
    ),
  },
  {
    path: "/admin/muster",
    lazy: page(
      () => import("../features/dashboard/muster-page"),
      (m) => m.MusterPage,
    ),
  },
  {
    path: "/admin/review",
    lazy: page(
      () => import("../features/review/review-page"),
      (m) => m.ReviewPage,
    ),
  },
  {
    path: "/admin/qr-cards",
    lazy: page(
      () => import("../features/qr-cards/qr-cards-page"),
      (m) => m.QrCardsPage,
    ),
  },
  {
    path: "/admin/contractors",
    lazy: page(
      () => import("../features/contractors/contractors-page"),
      (m) => m.ContractorsPage,
    ),
  },
  {
    path: "/admin/approvals",
    lazy: page(
      () => import("../features/approvals/approvals-page"),
      (m) => () => <m.ApprovalsPage mine={false} />,
    ),
  },
  {
    path: "/admin/my-requests",
    lazy: page(
      () => import("../features/approvals/approvals-page"),
      (m) => () => <m.ApprovalsPage mine />,
    ),
  },
  {
    path: "/admin/users",
    lazy: page(
      () => import("../features/users/users-page"),
      (m) => m.UsersPage,
    ),
  },
  {
    path: "/admin/settings",
    lazy: page(
      () => import("../features/settings/settings-page"),
      (m) => m.SettingsPage,
    ),
  },
  {
    path: "/admin/audit",
    lazy: page(
      () => import("../features/audit/audit-page"),
      (m) => m.AuditPage,
    ),
  },
  {
    path: "/admin/sessions",
    lazy: page(
      () => import("../features/auth/sessions-page"),
      (m) => m.SessionsPage,
    ),
  },
];

export const routes: RouteObject[] = [
  {
    // Shown (blank) for the moment the first page's code is loading.
    HydrateFallback: BlankWhileLoading,
    children: [
      { path: "/", element: <Navigate to="/admin" replace /> },
      // Pages that do not need a finished login.
      {
        path: "/admin/login",
        lazy: page(
          () => import("../features/auth/login-page"),
          (m) => m.LoginPage,
        ),
      },
      {
        path: "/admin/new-password",
        lazy: page(
          () => import("../features/auth/new-password-page"),
          (m) => m.NewPasswordPage,
        ),
      },
      {
        // Everything else in /admin needs a logged-in user and shows the menu.
        lazy: page(
          () => import("./layouts/require-auth"),
          (m) => m.RequireAuth,
        ),
        children: [
          {
            lazy: page(
              () => import("./layouts/admin-layout"),
              (m) => m.AdminLayout,
            ),
            children: adminPages,
          },
        ],
      },
      {
        path: "/attendance",
        lazy: page(
          () => import("../kiosk/kiosk-pairing-page"),
          (m) => m.KioskPairingPage,
        ),
      },
      {
        // The public privacy notice: no login, no admin menu (SPDI Rule 4).
        path: "/privacy",
        lazy: page(
          () => import("../features/privacy/privacy-page"),
          (m) => m.PrivacyPage,
        ),
      },
      { path: "/kiosk", element: <OldGateAddress /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];

export function createAppRouter() {
  return createBrowserRouter(routes);
}
