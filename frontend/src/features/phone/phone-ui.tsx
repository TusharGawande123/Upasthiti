// Small building blocks shared by all phone pages (design gates P1 and P2): big buttons (60 px),
// 18 px text, a problem card (icon + words + one button) and the two step pills. One column,
// every message has an icon and words, never colour alone.
import { CircleAlert, Info, Loader2, type LucideIcon } from "lucide-react";
import type * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function PhoneButton({
  busy,
  children,
  className,
  disabled,
  ...props
}: React.ComponentProps<typeof Button> & { busy?: boolean }) {
  return (
    <Button
      size="lg"
      className={cn("h-15 w-full whitespace-normal text-lg", className)}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...props}
    >
      {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
      {children}
    </Button>
  );
}

export function PhoneCard({ className, ...props }: React.ComponentProps<"section">) {
  return (
    <section
      className={cn(
        "rounded-xl border bg-card p-5 text-lg shadow-sm motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2",
        className,
      )}
      {...props}
    />
  );
}

export function PhoneTitle({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-4">
      <h1 className="text-[26px] leading-tight font-bold">{children}</h1>
      {hint ? <p className="mt-1 text-lg text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

const TONES = {
  danger: "border-destructive/40 bg-destructive-soft text-destructive",
  warning: "border-warning/40 bg-warning-soft text-warning",
  info: "border-primary/30 bg-primary-soft text-primary-soft-foreground",
  success: "border-success/40 bg-success-soft text-success",
} as const;

/** A message with an icon and words; errors are announced to screen readers. */
export function Notice({
  tone = "info",
  icon,
  children,
  className,
}: {
  tone?: keyof typeof TONES;
  icon?: LucideIcon;
  children: React.ReactNode;
  className?: string;
}) {
  const Icon = icon ?? (tone === "info" ? Info : CircleAlert);
  return (
    <div
      role={tone === "danger" || tone === "warning" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-3 rounded-lg border-2 border-l-8 p-4 text-lg font-medium",
        TONES[tone],
        className,
      )}
    >
      <Icon className="mt-0.5 size-6 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** A full card for a problem: big icon tile, title, message and the buttons that follow. */
export function ProblemCard({
  icon: Icon,
  tone,
  title,
  message,
  next,
  steps,
  children,
}: {
  icon: LucideIcon;
  tone: "amber" | "red" | "blue" | "grey";
  title: string;
  message?: string;
  next?: string;
  steps?: string[];
  children?: React.ReactNode;
}) {
  const tile = {
    amber: "bg-warning-soft text-warning",
    red: "bg-destructive-soft text-destructive",
    blue: "bg-primary-soft text-primary",
    grey: "border-2 border-dashed bg-muted text-muted-foreground",
  }[tone];
  return (
    <PhoneCard role={tone === "red" ? "alert" : "status"} className="space-y-4 text-center">
      <span className={cn("mx-auto grid size-24 place-items-center rounded-2xl", tile)}>
        <Icon className="size-12" aria-hidden />
      </span>
      <h2 className="text-[28px] leading-tight font-bold">{title}</h2>
      {message ? <p className="text-xl">{message}</p> : null}
      {next ? <p className="text-xl text-muted-foreground">{next}</p> : null}
      {steps ? (
        <ol className="list-decimal space-y-1 pl-6 text-left text-lg text-muted-foreground">
          {steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      ) : null}
      <div className="space-y-3 pt-2">{children}</div>
    </PhoneCard>
  );
}

/** "1 Check - 2 Password": the two steps of setting a password. */
export function StepPills({ current, labels }: { current: 1 | 2; labels: [string, string] }) {
  return (
    <ol className="mb-4 flex gap-2 text-base font-semibold">
      {labels.map((label, index) => (
        <li
          key={label}
          aria-current={current === index + 1 ? "step" : undefined}
          className={cn(
            "flex items-center gap-2 rounded-full border px-3 py-1",
            current === index + 1
              ? "border-primary bg-primary text-primary-foreground"
              : "bg-card text-muted-foreground",
          )}
        >
          <span aria-hidden>{index + 1}</span>
          {label}
        </li>
      ))}
    </ol>
  );
}
