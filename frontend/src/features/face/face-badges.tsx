// The face state badge of the employees list and the face panel (spec M3 §4.7, §4.10). Status is
// never shown by colour alone: every badge has an icon AND a word.
import { CircleDashed, History, QrCode, ScanFace, TriangleAlert, UserX } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import type { FaceState } from "./use-face";

export function FaceStateBadge({ state }: { state: FaceState }) {
  const { t } = useTranslation();
  const label = t(`face.state.${state}`);
  switch (state) {
    case "enrolled":
      return (
        <Badge tone="success">
          <ScanFace aria-hidden />
          {label}
        </Badge>
      );
    case "not_enrolled":
      return (
        <Badge tone="neutral">
          <CircleDashed aria-hidden />
          {label}
        </Badge>
      );
    case "reenrol_suggested":
      return (
        <Badge tone="warning">
          <TriangleAlert aria-hidden />
          {label}
        </Badge>
      );
    case "old_model":
      // Only when the stored template was made by another face model than the running one.
      return (
        <Badge tone="warning">
          <History aria-hidden />
          {label}
        </Badge>
      );
    case "withdrawn":
      return (
        <Badge tone="neutral">
          <UserX aria-hidden />
          {label}
        </Badge>
      );
    default:
      return (
        <Badge tone="neutral" className="border bg-card">
          <QrCode aria-hidden />
          {label}
        </Badge>
      );
  }
}
