// Gate notices on the scanning screen (F-25, spec §4.2 as approved in design gate B): important
// notices first with a warning icon and the word "Important"; long text wraps, never scrolls.
// What does not fit rotates every 8 s: more than 3 notices, or more than 1 on a phone.
import { Megaphone, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { KioskNotice } from "./punch-types";

export const ROTATE_EVERY_MS = 8_000;
const PHONE_WIDTH = 640;

function perPage(): number {
  return typeof window !== "undefined" && window.innerWidth < PHONE_WIDTH ? 1 : 3;
}

/** Important ones first in every round, then the order the server sent. */
export function orderNotices(notices: KioskNotice[]): KioskNotice[] {
  const important = notices.filter((notice) => notice.level === "important");
  return [...important, ...notices.filter((notice) => notice.level !== "important")];
}

export function NoticesPanel({ notices }: { notices: KioskNotice[] }) {
  const { t } = useTranslation();
  const [page, setPage] = useState(0);
  const size = perPage();
  const ordered = orderNotices(notices);
  const pages = Math.max(1, Math.ceil(ordered.length / size));

  useEffect(() => {
    if (pages <= 1) return;
    const timer = setInterval(() => setPage((current) => (current + 1) % pages), ROTATE_EVERY_MS);
    return () => clearInterval(timer);
  }, [pages]);

  if (ordered.length === 0) return null;
  const current = page % pages;
  const shown = ordered.slice(current * size, current * size + size);

  return (
    <section aria-label={t("kiosk.attendance.notices")} className="space-y-3">
      <ul className="space-y-3">
        {shown.map((notice) => {
          const important = notice.level === "important";
          return (
            <li
              key={notice.id}
              className={cn(
                "flex items-start gap-3 rounded-2xl border-2 px-5 py-3 text-[24px] leading-snug",
                important ? "border-warning bg-warning-soft" : "border-border-strong bg-card",
              )}
            >
              {important ? (
                <TriangleAlert className="mt-1 size-7 shrink-0 text-warning" aria-hidden />
              ) : (
                <Megaphone className="mt-1 size-7 shrink-0 text-muted-foreground" aria-hidden />
              )}
              <p className="min-w-0 break-words">
                {important ? (
                  <b className="mr-2 rounded-md border-2 border-warning bg-[var(--flood-already)] px-2 text-foreground">
                    {t("kiosk.attendance.important")}
                  </b>
                ) : null}
                {notice.text}
              </p>
            </li>
          );
        })}
      </ul>
      {pages > 1 ? (
        <p className="text-[24px] font-bold" aria-live="off">
          {t("kiosk.attendance.noticePage", { current: current + 1, total: pages })}
        </p>
      ) : null}
    </section>
  );
}
