// Native dropdown styled like our inputs. A native <select> is the most accessible choice.
import type * as React from "react";
import { cn } from "@/lib/utils";

export function Select({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-11 w-full rounded-md border border-input bg-card px-3 text-[15px] shadow-xs disabled:bg-muted",
        className,
      )}
      {...props}
    />
  );
}
