// One form row: label, control, optional hint, and an error message under the control.
import type * as React from "react";
import { Label } from "@/components/ui/label";

type FieldProps = {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
};

export function Field({ id, label, hint, error, children }: FieldProps) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && !error ? <p className="mt-1 text-[13px] text-muted-foreground">{hint}</p> : null}
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-[13px] font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
