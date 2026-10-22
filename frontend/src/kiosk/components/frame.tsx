// The kiosk page frame: safety stripe, top bar, the screen in the middle and a footer. Every
// kiosk screen (pairing, scanning, results, problems) sits inside it, so they look like one family.
import { useTranslation } from "react-i18next";

const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? "dev";

export function Frame({
  title,
  subtitle,
  aside,
  footer,
  children,
}: {
  title: React.ReactNode;
  subtitle: React.ReactNode;
  /** The right side of the top bar: a status chip, the clock... */
  aside?: React.ReactNode;
  /** Replaces the default footer ("Need help?" and the app version). */
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="kiosk-theme flex min-h-screen flex-col bg-background">
      {/* Safety-stripe: decoration only (yellow is never used for text). */}
      <div
        aria-hidden
        className="h-3 shrink-0 bg-[repeating-linear-gradient(135deg,var(--signal)_0_18px,#0f172a_18px_36px)]"
      />
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b bg-card px-4 py-4 sm:px-8 sm:py-5">
        <div>
          <p className="text-[30px] leading-tight font-extrabold">{title}</p>
          <p className="text-[24px] text-muted-foreground">{subtitle}</p>
        </div>
        {aside}
      </header>
      <main className="flex flex-1 flex-col justify-center px-4 py-6 sm:px-8">{children}</main>
      {footer ?? <DefaultFooter />}
    </div>
  );
}

function DefaultFooter() {
  const { t } = useTranslation();
  return (
    <footer className="flex flex-wrap items-center justify-between gap-x-4 border-t bg-card px-4 py-4 text-[24px] text-muted-foreground sm:px-8">
      <span>{t("kiosk.help")}</span>
      <span className="tnum">{t("kiosk.version", { version: APP_VERSION })}</span>
    </footer>
  );
}
