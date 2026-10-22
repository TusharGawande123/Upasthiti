// A rounded status chip for the kiosk top bar. Always an icon AND a word, never colour alone.
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type ChipTone = "success" | "neutral" | "warning" | "danger";

const TONE_CLASSES: Record<ChipTone, string> = {
  success: "border-success/30 bg-success-soft text-success",
  neutral: "bg-muted text-foreground",
  warning: "border-warning/30 bg-warning-soft text-warning",
  danger: "border-destructive/30 bg-destructive-soft text-destructive",
};

export function StatusChip({
  tone,
  icon: Icon,
  children,
}: {
  tone: ChipTone;
  icon: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-5 py-2 text-[24px] font-bold",
        TONE_CLASSES[tone],
      )}
    >
      <Icon className="size-6" aria-hidden />
      {children}
    </span>
  );
}
