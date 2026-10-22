// The admin shell: left menu, top bar (search, plant filter, user menu) and the page itself.
// The menu shows only what the user's role may use; the server checks it again anyway.
import {
  ClipboardCheck,
  Factory,
  FileSpreadsheet,
  HardHat,
  History,
  IdCard,
  LayoutDashboard,
  ListChecks,
  type LucideIcon,
  Megaphone,
  Printer,
  QrCode,
  ScrollText,
  Search,
  Send,
  Settings,
  Tablet,
  UserRound,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, Outlet } from "react-router";
import { usePendingCount } from "@/features/approvals/use-approvals";
import { BrandMark } from "@/features/auth/brand-mark";
import { type Me, type Role, useMe } from "@/features/auth/use-auth";
import { useExpiringCount } from "@/features/qr-cards/use-qr-cards";
import { CommandPalette, type PaletteCommand } from "@/features/search/command-palette";
import { cn } from "@/lib/utils";
import { PlantFilterProvider, PlantFilterSelect } from "./plant-filter";
import { UserMenu } from "./user-menu";

type NavItem = {
  to: string;
  labelKey: string;
  icon: LucideIcon;
  roles: Role[];
  end?: boolean;
  // A small number next to the label (the approvals waiting for the Super Admin).
  badge?: "pendingApprovals" | "expiringCards";
};

const ALL_ROLES: Role[] = ["super_admin", "corporate_head", "plant_head"];

// New pages are added here as their features arrive.
const NAV_ITEMS: NavItem[] = [
  { to: "/admin", labelKey: "nav.dashboard", icon: LayoutDashboard, roles: ALL_ROLES, end: true },
  { to: "/admin/setup", labelKey: "nav.setup", icon: ListChecks, roles: ["super_admin"] },
  {
    to: "/admin/approvals",
    labelKey: "nav.approvals",
    icon: ClipboardCheck,
    roles: ["super_admin"],
    badge: "pendingApprovals",
  },
  { to: "/admin/my-requests", labelKey: "nav.myRequests", icon: Send, roles: ["corporate_head"] },
  { to: "/admin/plants", labelKey: "nav.plants", icon: Factory, roles: ALL_ROLES },
  { to: "/admin/kiosks", labelKey: "nav.kiosks", icon: Tablet, roles: ALL_ROLES },
  // The punch log: every role reads it (the server limits a Plant Head to their own plant).
  { to: "/admin/punches", labelKey: "nav.punches", icon: History, roles: ALL_ROLES },
  // Everyone reads gate notices; the Super Admin and the Plant Head write them (the server decides).
  { to: "/admin/notices", labelKey: "nav.notices", icon: Megaphone, roles: ALL_ROLES },
  { to: "/admin/employees", labelKey: "nav.employees", icon: UserRound, roles: ALL_ROLES },
  {
    to: "/admin/import",
    labelKey: "nav.import",
    icon: FileSpreadsheet,
    roles: ["super_admin", "corporate_head"],
  },
  // Everyone may read the cards list; only the Super Admin changes cards (the server decides).
  {
    to: "/admin/qr-cards",
    labelKey: "nav.qrCards",
    icon: QrCode,
    roles: ALL_ROLES,
    badge: "expiringCards", // cards that end soon; counted for the Super Admin only
  },
  { to: "/admin/contractors", labelKey: "nav.contractors", icon: HardHat, roles: ALL_ROLES },
  { to: "/admin/users", labelKey: "nav.users", icon: Users, roles: ["super_admin"] },
  { to: "/admin/settings", labelKey: "nav.settings", icon: Settings, roles: ALL_ROLES },
  { to: "/admin/audit", labelKey: "nav.audit", icon: ScrollText, roles: ALL_ROLES },
];

export function visibleNavItems(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}

function AdminShell({ user }: { user: Me }) {
  const { t } = useTranslation();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const items = visibleNavItems(user.role);
  const pending = usePendingCount(user.role === "super_admin");
  const expiring = useExpiringCount(user.role === "super_admin");

  // Ctrl+K (or Cmd+K on a Mac) opens the palette from anywhere in the admin area.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const badgeFor = (item: NavItem): number => {
    if (item.badge === "pendingApprovals") return pending.data?.count ?? 0;
    if (item.badge === "expiringCards") return expiring.data?.count ?? 0;
    return 0;
  };

  // Commands for the Ctrl+K palette. Only the Super Admin issues and prints cards.
  const commands: PaletteCommand[] =
    user.role === "super_admin"
      ? [
          {
            id: "issue-card",
            kind: "pickEmployee",
            label: t("palette.command.issue.label"),
            hint: t("palette.command.issue.hint"),
            placeholder: t("palette.command.issue.placeholder"),
            icon: IdCard,
            pathFor: (employeeId) => `/admin/employees/${employeeId}?issue=card`,
          },
          {
            id: "print-cards",
            kind: "go",
            label: t("palette.command.print.label"),
            hint: t("palette.command.print.hint"),
            icon: Printer,
            to: "/admin/qr-cards?printed=no",
          },
        ]
      : [];

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
        <nav
          aria-label={t("nav.label")}
          className="flex-1 space-y-1 overflow-y-auto px-2 py-2 xl:px-3"
        >
          {items.map((item) => {
            const { to, labelKey, icon: Icon, end } = item;
            const count = badgeFor(item);
            return (
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
                    {count > 0 ? (
                      <span className="tnum ml-auto hidden rounded-full bg-primary px-2 text-xs font-bold text-primary-foreground xl:inline">
                        {count}
                        <span className="sr-only">
                          {" "}
                          {t(item.badge === "expiringCards" ? "nav.endingSoon" : "nav.waiting")}
                        </span>
                      </span>
                    ) : null}
                  </>
                )}
              </NavLink>
            );
          })}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-card/90 px-5 backdrop-blur lg:px-8">
          <div className="lg:hidden">
            <BrandMark />
          </div>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="hidden h-10 w-full max-w-sm cursor-pointer items-center gap-2 rounded-md border border-border-strong bg-card px-3 text-left text-sm text-muted-foreground shadow-xs hover:bg-muted md:flex"
          >
            <Search className="size-4" aria-hidden />
            <span className="flex-1 truncate">{t("palette.placeholder")}</span>
            <kbd className="rounded border px-1.5 text-xs">Ctrl K</kbd>
          </button>
          <button
            type="button"
            aria-label={t("palette.open")}
            onClick={() => setPaletteOpen(true)}
            className="grid size-10 cursor-pointer place-items-center rounded-md border md:hidden"
          >
            <Search className="size-4" aria-hidden />
          </button>
          <PlantFilterSelect />
          <div className="ml-auto">
            <UserMenu user={user} />
          </div>
        </header>
        <main className="flex-1 p-5 lg:p-8">
          <Outlet />
        </main>
      </div>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        pages={items.map((item) => ({ to: item.to, label: t(item.labelKey) }))}
        commands={commands}
      />
    </div>
  );
}

export function AdminLayout() {
  const me = useMe();
  const user = me.data as Me;
  return (
    <PlantFilterProvider user={user}>
      <AdminShell user={user} />
    </PlantFilterProvider>
  );
}
