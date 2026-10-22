// The menu button and slide-out menu for phones and tablets. The left menu only fits from
// 1024 px up, so below that this is the way to reach every page.
import { Menu, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { BrandMark } from "@/features/auth/brand-mark";
import { type NavItem, NavLinks } from "./nav-links";

export function MobileMenu({
  items,
  badgeFor,
}: {
  items: NavItem[];
  badgeFor: (item: NavItem) => number;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger
        aria-label={t("nav.open")}
        className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-md border border-border-strong bg-card lg:hidden"
      >
        <Menu className="size-5" aria-hidden />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-foreground/40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r bg-card shadow-lg"
        >
          <Dialog.Title className="sr-only">{t("nav.label")}</Dialog.Title>
          <div className="flex h-16 shrink-0 items-center justify-between px-4">
            <BrandMark />
            <Dialog.Close
              aria-label={t("common.close")}
              className="grid size-11 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-muted"
            >
              <X className="size-5" aria-hidden />
            </Dialog.Close>
          </div>
          <nav aria-label={t("nav.label")} className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
            <NavLinks
              items={items}
              badgeFor={badgeFor}
              alwaysShowLabels
              onNavigate={() => setOpen(false)}
            />
          </nav>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
