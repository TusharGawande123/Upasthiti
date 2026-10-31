// The list of menu links, shared by the left menu (laptop and PC) and the slide-out menu (phone
// and tablet), so both always show the same pages with the same badges.
import type { LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router";
import type { Role } from "@/features/auth/use-auth";
import { cn } from "@/lib/utils";

export type NavItem = {
  to: string;
  labelKey: string;
  icon: LucideIcon;
  roles: Role[];
  end?: boolean;
  // A small number next to the label (the approvals waiting for the Super Admin).
  badge?:
    | "pendingApprovals"
    | "expiringCards"
    | "offlineDevices"
    | "toCheck"
    | "pendingCorrections";
};

type NavLinksProps = {
  items: NavItem[];
  badgeFor: (item: NavItem) => number;
  /** The slide-out menu always shows the words; the left menu hides them below 1280 px. */
  alwaysShowLabels?: boolean;
  /** Called after a link is chosen (the slide-out menu closes itself). */
  onNavigate?: () => void;
};

// What a screen reader says after the number of each menu badge.
const BADGE_WORDS = {
  pendingApprovals: "nav.waiting",
  expiringCards: "nav.endingSoon",
  offlineDevices: "nav.offline",
  toCheck: "nav.toCheck",
  pendingCorrections: "nav.waiting",
} as const;

export function NavLinks({ items, badgeFor, alwaysShowLabels, onNavigate }: NavLinksProps) {
  const { t } = useTranslation();
  const labelVisibility = alwaysShowLabels ? "inline" : "hidden xl:inline";

  return (
    <>
      {items.map((item) => {
        const { to, labelKey, icon: Icon, end } = item;
        const count = badgeFor(item);
        return (
          <NavLink
            key={to}
            to={to}
            end={end}
            title={t(labelKey)}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                "relative flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium text-muted-foreground hover:bg-muted",
                alwaysShowLabels && "h-11",
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
                <span className={labelVisibility}>{t(labelKey)}</span>
                {count > 0 ? (
                  <span
                    className={cn(
                      "tnum ml-auto rounded-full bg-primary px-2 text-xs font-bold text-primary-foreground",
                      alwaysShowLabels ? "inline" : "hidden xl:inline",
                    )}
                  >
                    {count}
                    <span className="sr-only">
                      {" "}
                      {t(BADGE_WORDS[item.badge ?? "pendingApprovals"])}
                    </span>
                  </span>
                ) : null}
              </>
            )}
          </NavLink>
        );
      })}
    </>
  );
}
