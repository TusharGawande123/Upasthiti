// Message box for errors, warnings and notes. Always an icon plus words.
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";

const alertVariants = cva(
  "flex items-start gap-2.5 rounded-md border p-3 text-sm [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0",
  {
    variants: {
      tone: {
        info: "border-primary/25 bg-primary-soft text-primary-soft-foreground",
        warning: "border-warning/30 bg-warning-soft text-warning",
        danger: "border-destructive/30 bg-destructive-soft text-destructive",
      },
    },
    defaultVariants: { tone: "info" },
  },
);

type AlertProps = React.ComponentProps<"div"> & VariantProps<typeof alertVariants>;

export function Alert({ className, tone, ...props }: AlertProps) {
  const role = tone === "danger" || tone === "warning" ? "alert" : "status";
  return <div role={role} className={cn(alertVariants({ tone }), className)} {...props} />;
}
