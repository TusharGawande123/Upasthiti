// The admin shell: left menu, top bar (search, plant filter, user menu) and the page itself.
// The menu shows only what the user's role may use; the server checks it again anyway.
import {
  CircleDashed,
  CircleX,
  ClipboardCheck,
  Factory,
  FileSpreadsheet,
  Flag,
  HardHat,
  History,
  IdCard,
  LayoutDashboard,
  ListChecks,
  Megaphone,
  Printer,
  QrCode,
  ScanFace,
  ScrollText,
  Search,
  Send,
  Settings,
  Tablet,
  TriangleAlert,
  UserRound,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Outlet } from "react-router";
import { usePendingCount } from "@/features/approvals/use-approvals";
import { BrandMark } from "@/features/auth/brand-mark";
import { type Me, type Role, useMe } from "@/features/auth/use-auth";
import {
  OfflineAlertBanner,
  OfflineBadge,
  useOfflineSummary,
} from "@/features/kiosks/offline-alert";
import { useExpiringCount } from "@/features/qr-cards/use-qr-cards";
import { useReviewSummary } from "@/features/review/use-review";
import { CommandPalette, type PaletteCommand } from "@/features/search/command-palette";
import { MobileMenu } from "./mobile-menu";
import { type NavItem, NavLinks } from "./nav-links";
import { PlantFilterProvider, PlantFilterSelect } from "./plant-filter";
import { UserMenu } from "./user-menu";

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
  {
    to: "/admin/kiosks",
    labelKey: "nav.kiosks",
    icon: Tablet,
    roles: ALL_ROLES,
    badge: "offlineDevices", // attendance devices that are offline now (M4 F-36)
  },
  // The punch log: every role reads it (the server limits a Plant Head to their own plant).
  { to: "/admin/punches", labelKey: "nav.punches", icon: History, roles: ALL_ROLES },
  // M4: flagged punches to check and rejected punches to approve. Super Admin only.
  {
    to: "/admin/review",
    labelKey: "nav.review",
    icon: Flag,
    roles: ["super_admin"],
    badge: "toCheck",
  },
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
  const deviceSummary = useOfflineSummary();
  const reviews = useReviewSummary(user.role === "super_admin");

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
    if (item.badge === "offlineDevices") return deviceSummary?.offline ?? 0;
    if (item.badge === "toCheck") return reviews.data?.to_check ?? 0;
    return 0;
  };

  // Commands for the Ctrl+K palette. Only the Super Admin issues and prints cards.
  // The two face lists are for every role (the server limits them to the user's plants); only the
  // Super Admin enrols faces (decision 0016 item 3).
  const faceListCommands: PaletteCommand[] = [
    {
      id: "not-enrolled",
      kind: "go",
      label: t("palette.command.notEnrolled.label"),
      hint: t("palette.command.notEnrolled.hint"),
      icon: CircleDashed,
      to: "/admin/employees?face_state=not_enrolled",
    },
    {
      id: "reenrol",
      kind: "go",
      label: t("palette.command.reenrol.label"),
      hint: t("palette.command.reenrol.hint"),
      icon: TriangleAlert,
      to: "/admin/employees?face_state=reenrol_suggested",
    },
  ];
  const commands: PaletteCommand[] =
    user.role === "super_admin"
      ? [
          {
            id: "enrol-face",
            kind: "pickEmployee",
            label: t("palette.command.enrol.label"),
            hint: t("palette.command.enrol.hint"),
            placeholder: t("palette.command.enrol.placeholder"),
            icon: ScanFace,
            pathFor: (employeeId) => `/admin/employees/${employeeId}?face=enrol`,
          },
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
          {
            id: "needs-review",
            kind: "go",
            label: t("palette.command.review.label"),
            hint: t("palette.command.review.hint"),
            icon: Flag,
            to: "/admin/review",
          },
          {
            id: "rejected-punches",
            kind: "go",
            label: t("palette.command.rejected.label"),
            hint: t("palette.command.rejected.hint"),
            icon: CircleX,
            to: "/admin/review?tab=rejected",
          },
        ]
      : [];
  commands.push(...faceListCommands);

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
          <NavLinks items={items} badgeFor={badgeFor} />
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b bg-card/90 px-3 backdrop-blur sm:gap-3 sm:px-5 lg:px-8">
          <MobileMenu items={items} badgeFor={badgeFor} />
          <div className="hidden sm:block lg:hidden">
            <BrandMark />
          </div>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="hidden h-10 w-full min-w-0 max-w-sm cursor-pointer items-center gap-2 rounded-md border border-border-strong bg-card px-3 text-left text-sm text-muted-foreground shadow-xs hover:bg-muted md:flex"
          >
            <Search className="size-4" aria-hidden />
            <span className="flex-1 truncate">{t("palette.placeholder")}</span>
            <kbd className="rounded border px-1.5 text-xs">Ctrl K</kbd>
          </button>
          <button
            type="button"
            aria-label={t("palette.open")}
            onClick={() => setPaletteOpen(true)}
            className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-md border md:hidden"
          >
            <Search className="size-4" aria-hidden />
          </button>
          <PlantFilterSelect />
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <OfflineBadge summary={deviceSummary} />
            <UserMenu user={user} />
          </div>
        </header>
        <OfflineAlertBanner summary={deviceSummary} />
        <main className="min-w-0 flex-1 p-4 sm:p-5 lg:p-8">
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
