// Table parts (shadcn/ui style): a scrollable wrapper with a header and bordered rows.
import type * as React from "react";
import { cn } from "@/lib/utils";

export function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div className="overflow-x-auto">
      <table className={cn("w-full caption-bottom text-[13.5px]", className)} {...props} />
    </div>
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
