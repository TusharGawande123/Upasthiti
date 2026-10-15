// Form label (shadcn/ui style).
import type * as React from "react";
import { cn } from "@/lib/utils";

export function Label({ className, ...props }: React.ComponentProps<"label">) {
  // biome-ignore lint/a11y/noLabelWithoutControl: the caller passes htmlFor.
  return <label className={cn("mb-1.5 block text-sm font-semibold", className)} {...props} />;
}
