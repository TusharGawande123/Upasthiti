// All page addresses of the website. One app, two areas: /admin (dashboard) and /kiosk (gate).
import { createBrowserRouter, Navigate, type RouteObject } from "react-router";
import { DashboardPage } from "../features/admin/dashboard-page";
import { ApprovalsPage } from "../features/approvals/approvals-page";
import { AuditPage } from "../features/audit/audit-page";
import { LoginPage } from "../features/auth/login-page";
import { NewPasswordPage } from "../features/auth/new-password-page";
import { SessionsPage } from "../features/auth/sessions-page";
import { ContractorsPage } from "../features/contractors/contractors-page";
import { EmployeeDetailPage } from "../features/employees/employee-detail-page";
import { EmployeeFormPage } from "../features/employees/employee-form-page";
import { EmployeesPage } from "../features/employees/employees-page";
import { ImportPage } from "../features/employees/import-page";
import { KiosksPage } from "../features/kiosks/kiosks-page";
import { PlantDetailPage } from "../features/plants/plant-detail-page";
import { PlantsPage } from "../features/plants/plants-page";
import { SetupWizardPage } from "../features/plants/setup-wizard-page";
import { QrCardsPage } from "../features/qr-cards/qr-cards-page";
import { SettingsPage } from "../features/settings/settings-page";
import { UsersPage } from "../features/users/users-page";
import { KioskPairingPage } from "../kiosk/kiosk-pairing-page";
import { AdminLayout } from "./layouts/admin-layout";
import { RequireAuth } from "./layouts/require-auth";
import { NotFoundPage } from "./not-found-page";

export const routes: RouteObject[] = [
  { path: "/", element: <Navigate to="/admin" replace /> },
  // Pages that do not need a finished login.
  { path: "/admin/login", element: <LoginPage /> },
  { path: "/admin/new-password", element: <NewPasswordPage /> },
  {
    // Everything else in /admin needs a logged-in user and shows the menu.
    element: <RequireAuth />,
    children: [
      {
        element: <AdminLayout />,
        children: [
          { path: "/admin", element: <DashboardPage /> },
          { path: "/admin/setup", element: <SetupWizardPage /> },
          { path: "/admin/plants", element: <PlantsPage /> },
          { path: "/admin/plants/:plantId", element: <PlantDetailPage /> },
          { path: "/admin/kiosks", element: <KiosksPage /> },
          { path: "/admin/employees", element: <EmployeesPage /> },
          { path: "/admin/employees/new", element: <EmployeeFormPage /> },
          { path: "/admin/employees/:employeeId", element: <EmployeeDetailPage /> },
          { path: "/admin/employees/:employeeId/edit", element: <EmployeeFormPage /> },
          { path: "/admin/import", element: <ImportPage /> },
          { path: "/admin/qr-cards", element: <QrCardsPage /> },
          { path: "/admin/contractors", element: <ContractorsPage /> },
          { path: "/admin/approvals", element: <ApprovalsPage mine={false} /> },
          { path: "/admin/my-requests", element: <ApprovalsPage mine /> },
          { path: "/admin/users", element: <UsersPage /> },
          { path: "/admin/settings", element: <SettingsPage /> },
          { path: "/admin/audit", element: <AuditPage /> },
          { path: "/admin/sessions", element: <SessionsPage /> },
        ],
      },
    ],
  },
  { path: "/kiosk", element: <KioskPairingPage /> },
  { path: "*", element: <NotFoundPage /> },
];

export function createAppRouter() {
  return createBrowserRouter(routes);
}
