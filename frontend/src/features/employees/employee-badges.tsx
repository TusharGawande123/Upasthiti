// Small status pieces used on the employee list, detail and approvals. Status is never shown by
// colour alone: each badge has an icon AND a word.
import { Ban, CircleCheck, Hourglass, QrCode, ScanFace } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import type { Employee } from "./use-employees";

export function TypeBadge({ type }: { type: Employee["type"] }) {
  const { t } = useTranslation();
  return type === "permanent" ? (
    <Badge tone="primary">
      <ScanFace aria-hidden />
      {t("employees.type.permanent")}
    </Badge>
  ) : (
    <Badge tone="warning">
      <QrCode aria-hidden />
      {t("employees.type.temporary")}
    </Badge>
  );
}

export function EmployeeStatusBadge({ status }: { status: Employee["status"] }) {
  const { t } = useTranslation();
  return status === "active" ? (
    <Badge tone="success">
      <CircleCheck aria-hidden />
      {t("employees.status.active")}
    </Badge>
  ) : (
    <Badge tone="neutral">
      <Ban aria-hidden />
      {t("employees.status.left")}
    </Badge>
  );
}

/** Shown under the name when a Corporate Head's change is waiting for the Super Admin. */
export function ChangeWaiting() {
  const { t } = useTranslation();
  return (
    <span className="flex items-center gap-1 text-xs font-semibold text-warning">
      <Hourglass className="size-3" aria-hidden />
      {t("employees.changeWaiting")}
    </span>
  );
}

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
