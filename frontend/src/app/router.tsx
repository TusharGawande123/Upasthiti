// All page addresses of the website. One app, two areas: /admin (dashboard) and /kiosk (gate).
import { createBrowserRouter, Navigate, type RouteObject } from "react-router";
import { AdminPlaceholderPage } from "../features/admin/admin-placeholder-page";
import { KioskPlaceholderPage } from "../kiosk/kiosk-placeholder-page";
import { NotFoundPage } from "./not-found-page";

export const routes: RouteObject[] = [
  { path: "/", element: <Navigate to="/admin" replace /> },
  { path: "/admin", element: <AdminPlaceholderPage /> },
  { path: "/kiosk", element: <KioskPlaceholderPage /> },
  { path: "*", element: <NotFoundPage /> },
];

export function createAppRouter() {
  return createBrowserRouter(routes);
}
