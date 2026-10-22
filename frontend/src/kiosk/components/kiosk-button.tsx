// Big touch button used all over the kiosk (touch targets of at least 64 px, spec §4).
import { cn } from "@/lib/utils";

export function KioskButton({
  className,
  variant = "primary",
  ...props
}: React.ComponentProps<"button"> & { variant?: "primary" | "key" }) {
  return (
    <button
      type="button"
      className={cn(
        "flex min-h-[72px] cursor-pointer items-center justify-center gap-3 rounded-2xl text-[28px] font-bold shadow-[0_4px_0_0_rgba(15,23,42,0.18)] transition active:translate-y-[2px] active:shadow-none disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground",
        variant === "primary"
          ? "bg-primary px-8 text-primary-foreground hover:bg-primary-hover"
          : "border bg-card text-foreground hover:bg-muted",
        className,
      )}
      {...props}
    />
  );
}
