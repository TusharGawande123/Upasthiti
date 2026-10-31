// The bell in the top bar: a button with the unread count (the number is written, not only
// coloured) that opens a panel with the newest alerts. The count is asked again every minute.
// The panel's code is loaded only when the bell is opened, so the admin first load stays small.
import { Bell } from "lucide-react";
import { Popover } from "radix-ui";
import { lazy, Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
import { useUnreadCount } from "./use-notifications";

const BellPanel = lazy(() => import("./bell-panel"));

export function NotificationBell() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const unread = useUnreadCount().data?.unread ?? 0;
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        aria-label={
          unread > 0
            ? t("notifications.bell.label", { count: unread })
            : t("notifications.bell.none")
        }
        className="relative grid size-11 shrink-0 cursor-pointer place-items-center rounded-md border border-border-strong bg-card hover:bg-muted"
      >
        <Bell className="size-5" aria-hidden />
        {unread > 0 ? (
          <span
            aria-hidden
            className="tnum absolute -top-1.5 -right-1.5 grid min-w-5 place-items-center rounded-full border-2 border-card bg-destructive px-1 text-[11px] leading-4 font-bold text-white"
          >
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          collisionPadding={8}
          className="z-50 w-[min(26rem,calc(100vw-1rem))] overflow-hidden rounded-xl border bg-popover shadow-lg"
        >
          {open ? (
            <Suspense
              fallback={
                <p className="p-4 text-sm text-muted-foreground">{t("notifications.loading")}</p>
              }
            >
              <BellPanel unread={unread} onClose={() => setOpen(false)} />
            </Suspense>
          ) : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
