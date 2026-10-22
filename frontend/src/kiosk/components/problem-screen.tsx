// A full-screen problem the worker or the admin must fix: big icon, title, message, numbered
// steps, one big button and the "For the admin: CODE" line (decision 0006).
import type { LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { KioskButton } from "./kiosk-button";

export function ProblemScreen({
  icon: Icon,
  serious,
  title,
  message,
  steps,
  extra,
  action,
  code,
}: {
  icon: LucideIcon;
  /** Red when the admin must fix it, amber when the worker can. */
  serious: boolean;
  title: string;
  message: string;
  steps: string[];
  extra?: React.ReactNode;
  action?: { label: string; icon: LucideIcon; onClick: () => void };
  code: string;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      className="mx-auto flex w-full max-w-3xl flex-col items-center gap-5 text-center"
    >
      <span
        className={cn(
          "grid size-32 place-items-center rounded-full",
          serious ? "bg-destructive-soft text-destructive" : "bg-warning-soft text-warning",
        )}
      >
        <Icon className="size-16" aria-hidden />
      </span>
      <h1 className="text-[48px] leading-tight font-extrabold">{title}</h1>
      <p className="text-[28px] leading-snug">{message}</p>
      {extra}
      <ol className="w-full max-w-2xl space-y-3 text-left">
        {steps.map((step, index) => (
          <li
            key={step}
            className="flex items-center gap-4 rounded-2xl border bg-card p-4 text-[24px]"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-signal text-[24px] font-extrabold text-foreground">
              {index + 1}
            </span>
            {step}
          </li>
        ))}
      </ol>
      {action ? (
        <KioskButton className="w-full max-w-2xl" onClick={action.onClick}>
          <action.icon className="size-8" aria-hidden />
          {action.label}
        </KioskButton>
      ) : null}
      <p className="text-[24px] text-muted-foreground">
        {t("kiosk.problem.forAdmin")} <b className="text-foreground">{code}</b>
      </p>
    </div>
  );
}
