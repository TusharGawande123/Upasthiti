// The menu under the user's name: my devices, change password, log out.
import { KeyRound, LogOut, MonitorSmartphone } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import type { Me } from "@/features/auth/use-auth";
import { useLogout } from "@/features/auth/use-auth";

const itemClasses =
  "flex cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-sm outline-none data-[highlighted]:bg-muted";

function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function UserMenu({ user }: { user: Me }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const logout = useLogout();

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-muted">
        <span className="grid size-8 place-items-center rounded-full bg-primary-soft text-xs font-bold text-primary-soft-foreground">
          {initialsOf(user.name)}
        </span>
        <span className="hidden text-left sm:block">
          <span className="block text-[13.5px] leading-tight font-semibold">{user.name}</span>
          <span className="block text-xs text-muted-foreground">{t(`roles.${user.role}`)}</span>
        </span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 min-w-56 rounded-lg border bg-popover p-1.5 shadow-lg"
        >
          <DropdownMenu.Item className={itemClasses} onSelect={() => navigate("/admin/sessions")}>
            <MonitorSmartphone className="size-4" aria-hidden />
            {t("userMenu.sessions")}
          </DropdownMenu.Item>
          <DropdownMenu.Item
            className={itemClasses}
            onSelect={() => navigate("/admin/new-password")}
          >
            <KeyRound className="size-4" aria-hidden />
            {t("userMenu.changePassword")}
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item
            className={itemClasses}
            onSelect={() => logout.mutate(undefined, { onSuccess: () => navigate("/admin/login") })}
          >
            <LogOut className="size-4" aria-hidden />
            {t("userMenu.logout")}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
