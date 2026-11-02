// The small "Phone" tag (icon + word) shown on an employee that has phone punching switched on:
// in the employees list, on the employee page and in "Cards ending soon" (spec M4b §4.13).
import { Smartphone } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";

export function PhoneTag({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <Badge tone="primary" className={className}>
      <Smartphone aria-hidden />
      {t("employees.phone.tag")}
    </Badge>
  );
}
