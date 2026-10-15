// Switch a plant off or on again. A reason is required because it goes to the audit log.
import { useTranslation } from "react-i18next";
import { describeError } from "@/features/auth/error-message";
import { ReasonDialog } from "@/features/users/user-dialogs";
import { type Plant, usePlantActiveToggle } from "./use-plants";

type Props = { plant: Plant; open: boolean; onOpenChange: (open: boolean) => void };

export function PlantStatusDialog({ plant, open, onOpenChange }: Props) {
  const { t } = useTranslation();
  const toggle = usePlantActiveToggle(plant.id);
  const turningOn = !plant.is_active;

  return (
    <ReasonDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) toggle.reset();
        onOpenChange(next);
      }}
      title={t(turningOn ? "plants.reactivateTitle" : "plants.deactivateTitle", {
        name: plant.name,
      })}
      confirmLabel={t(turningOn ? "plants.reactivate" : "plants.deactivate")}
      isPending={toggle.isPending}
      error={toggle.error ? describeError(toggle.error, t) : undefined}
      onConfirm={(reason) =>
        toggle.mutate({ active: turningOn, reason }, { onSuccess: () => onOpenChange(false) })
      }
    />
  );
}
