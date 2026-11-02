// The panel under the bell: the ten newest alerts, "Mark all as read" and "See all". It never
// opens by itself and makes no sound. Loaded only when the bell is opened.
import { BellRing, CheckCheck, List } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { NotificationRow } from "./notification-row";
import {
  type NotificationItem,
  useMarkAllRead,
  useMarkRead,
  useNotifications,
} from "./use-notifications";

export default function BellPanel({ unread, onClose }: { unread: number; onClose: () => void }) {
  const { t } = useTranslation();
  const latest = useNotifications({ page: 1, page_size: 10 });
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();
  const items = latest.data?.items ?? [];

  const open = (item: NotificationItem) => {
    if (!item.read) markRead.mutate(item.id);
    onClose();
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-2 border-b p-3">
        <h2 className="flex flex-wrap items-center gap-2 text-sm font-bold">
          {t("notifications.title")}
          <span className="rounded-full bg-destructive-soft px-2 py-0.5 text-xs font-bold text-destructive">
            {t("notifications.unreadCount", { count: unread })}
          </span>
        </h2>
        <Button
          variant="ghost"
          size="sm"
          disabled={unread === 0 || markAll.isPending}
          onClick={() => markAll.mutate()}
        >
          <CheckCheck aria-hidden />
          {t("notifications.markAll")}
        </Button>
      </div>
      <div className="max-h-[min(28rem,60vh)] overflow-y-auto">
        {latest.isPending ? (
          <div className="space-y-2 p-3" aria-busy="true">
            {["a", "b", "c"].map((id) => (
              <Skeleton key={id} className="h-16" />
            ))}
          </div>
        ) : latest.isError ? (
          <div role="alert" className="space-y-2 p-4 text-sm">
            <p className="font-bold">{t("notifications.error.title")}</p>
            <p className="text-muted-foreground">{t("notifications.error.bell")}</p>
            <Button variant="outline" size="sm" onClick={() => latest.refetch()}>
              {t("dashboard.live.tryAgain")}
            </Button>
          </div>
        ) : items.length === 0 ? (
          <div className="flex items-start gap-3 p-4 text-sm">
            <BellRing className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
            <div>
              <p className="font-bold">{t("notifications.empty.bellTitle")}</p>
              <p className="text-muted-foreground">{t("notifications.empty.bellBody")}</p>
            </div>
          </div>
        ) : (
          <ul className="divide-y">
            {items.map((item) => (
              <NotificationRow key={item.id} item={item} onOpen={open} />
            ))}
          </ul>
        )}
      </div>
      <div className="border-t p-2">
        <Link
          to="/admin/notifications"
          onClick={onClose}
          className={buttonVariants({ variant: "outline", className: "w-full" })}
        >
          <List aria-hidden />
          {t("notifications.seeAll")}
        </Link>
      </div>
    </div>
  );
}
