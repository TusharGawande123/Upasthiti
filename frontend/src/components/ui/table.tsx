// Table parts (shadcn/ui style): a scrollable wrapper with a header and bordered rows.
import type * as React from "react";
import { cn } from "@/lib/utils";

// On a phone the table keeps a readable width and scrolls sideways inside its card, instead of
// squeezing every column until the names break into five lines.
export function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    // `relative` keeps hidden screen-reader labels (position: absolute) inside the scrolling box.
    // tabIndex lets a keyboard user scroll the box sideways (axe: scrollable-region-focusable).
    // A named <section> is a region landmark, which is allowed to take keyboard focus.
    <section
      aria-label="Table"
      className="relative overflow-x-auto focus-visible:outline-2 focus-visible:outline-ring"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable box must be reachable by keyboard
      tabIndex={0}
    >
      <table
        className={cn("w-full min-w-[40rem] caption-bottom text-[13.5px]", className)}
        {...props}
      />
    </section>
  );
}

export function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead className={cn("bg-muted", className)} {...props} />;
}

export function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody className={cn("[&>tr:last-child]:border-0", className)} {...props} />;
}

export function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return <tr className={cn("border-b hover:bg-primary-soft/40", className)} {...props} />;
}

export function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      className={cn(
        "h-10 px-3 text-left text-xs font-semibold text-muted-foreground first:pl-4 last:pr-4",
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return <td className={cn("px-3 py-3 align-middle first:pl-4 last:pr-4", className)} {...props} />;
}
