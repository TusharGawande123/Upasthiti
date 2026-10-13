// Text input and textarea (shadcn/ui style). The edge colour passes the 3:1 contrast rule.
import type * as React from "react";
import { cn } from "@/lib/utils";

const fieldClasses =
  "w-full rounded-md border border-input bg-card px-3 text-[15px] text-foreground shadow-xs placeholder:text-subtle-foreground read-only:bg-muted disabled:cursor-not-allowed disabled:bg-muted aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/25";

export function Input({ className, type = "text", ...props }: React.ComponentProps<"input">) {
  return <input type={type} className={cn(fieldClasses, "h-11", className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea className={cn(fieldClasses, "min-h-24 py-2.5", className)} {...props} />;
}
