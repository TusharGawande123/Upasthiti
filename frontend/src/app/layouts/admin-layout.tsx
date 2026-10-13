// The admin shell: left menu, top bar with the user menu, and the page itself.
// The menu shows only what the user's role may use; the server checks it again anyway.
import {
  Factory,
  LayoutDashboard,
  ListChecks,
  type LucideIcon,
  ScrollText,
  Settings,
  Tablet,
  Users,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { NavLink, Outlet } from "react-router";
import { BrandMark } from "@/features/auth/brand-mark";
import { type Me, type Role, useMe } from "@/features/auth/use-auth";
import { cn } from "@/lib/utils";
import { UserMenu } from "./user-menu";

type NavItem = {
  to: string;
  labelKey: string;
  icon: LucideIcon;
  roles: Role[];
  end?: boolean;
};

const ALL_ROLES: Role[] = ["super_admin", "corporate_head", "plant_head"];

// New pages are added here as their features arrive.
const NAV_ITEMS: NavItem[] = [
  { to: "/admin", labelKey: "nav.dashboard", icon: LayoutDashboard, roles: ALL_ROLES, end: true },
  { to: "/admin/setup", labelKey: "nav.setup", icon: ListChecks, roles: ["super_admin"] },
  { to: "/admin/plants", labelKey: "nav.plants", icon: Factory, roles: ALL_ROLES },
  { to: "/admin/kiosks", labelKey: "nav.kiosks", icon: Tablet, roles: ALL_ROLES },
  { to: "/admin/users", labelKey: "nav.users", icon: Users, roles: ["super_admin"] },
  { to: "/admin/settings", labelKey: "nav.settings", icon: Settings, roles: ALL_ROLES },
  { to: "/admin/audit", labelKey: "nav.audit", icon: ScrollText, roles: ALL_ROLES },
];

export function visibleNavItems(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}

export function AdminLayout() {
  const { t } = useTranslation();
  const me = useMe();
  const user = me.data as Me;

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-16 shrink-0 flex-col border-r bg-card lg:flex xl:w-64">
        <div className="flex h-16 items-center px-4 xl:px-5">
          <span className="xl:hidden">
            <span className="grid size-9 place-items-center rounded-lg bg-primary">
              <span className="size-2.5 rounded-full bg-signal" />
            </span>
          </span>
          <span className="hidden xl:block">
            <BrandMark />
          </span>
        </div>
        <nav aria-label={t("nav.label")} className="flex-1 space-y-1 px-2 py-2 xl:px-3">
          {visibleNavItems(user.role).map(({ to, labelKey, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              title={t(labelKey)}
              className={({ isActive }) =>
                cn(
                  "relative flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium text-muted-foreground hover:bg-muted",
                  isActive && "bg-primary-soft font-bold text-primary-soft-foreground",
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive ? (
                    <span className="absolute top-2 bottom-2 left-0 w-1 rounded-full bg-signal" />
                  ) : null}
                  <Icon className="size-[18px] shrink-0" aria-hidden />
                  <span className="hidden xl:inline">{t(labelKey)}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b bg-card/90 px-5 backdrop-blur lg:px-8">
          <div className="lg:hidden">
            <BrandMark />
          </div>
          <div className="ml-auto">
            <UserMenu user={user} />
          </div>
        </header>
        <main className="flex-1 p-5 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
