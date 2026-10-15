// "Add kiosk" dialog: pick the plant and a name, then show the pairing code (also used for
// "New code" on a kiosk that is waiting). A plant without a geofence cannot get a kiosk,
// because a kiosk must prove it is inside it (decision 0005).
import { Loader2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { describeError } from "@/features/auth/error-message";
import { usePlants } from "@/features/plants/use-plants";
import { ApiError } from "@/lib/api-client";
import { PairingCodeView } from "./pairing-code-view";
import { type KioskWithCode, useCreateKiosk } from "./use-kiosks";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // A code already issued (the "New code" action); null = the form for a new kiosk.
  issued: KioskWithCode | null;
  onIssued: (issued: KioskWithCode | null) => void;
  // The plant to preselect (when opened from a plant's own page).
  defaultPlantId?: string;
};

export function AddKioskDialog({ open, onOpenChange, issued, onIssued, defaultPlantId }: Props) {
  const { t } = useTranslation();
  const plants = usePlants({ is_active: true });
  const create = useCreateKiosk();
  const [plantChoice, setPlantChoice] = useState(defaultPlantId ?? "");
  const [name, setName] = useState("");

  const items = plants.data?.items ?? [];
  // A Plant Head sees only the own plant, so it is chosen without asking.
  const plantId = plantChoice || (items.length === 1 ? (items[0]?.id ?? "") : "");
  const plant = items.find((item) => item.id === plantId);
  const noGeofence = create.error instanceof ApiError && create.error.code === "GEOFENCE_NOT_SET";

  const close = (next: boolean) => {
    if (!next) {
      create.reset();
      setName("");
      onIssued(null);
    }
    onOpenChange(next);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!plantId || !name.trim()) return;
    create.mutate({ plant_id: plantId, name: name.trim() }, { onSuccess: onIssued });
  };

  const plantLabel = (code: string, plantName: string) => `${code} · ${plantName}`;
  const issuedPlant = issued ? items.find((item) => item.id === issued.kiosk.plant_id) : undefined;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-2xl">
        <DialogTitle>
          {issued ? t("kiosks.code.title", { name: issued.kiosk.name }) : t("kiosks.add.title")}
        </DialogTitle>
        <DialogDescription>
          {issued
            ? issuedPlant && plantLabel(issuedPlant.code, issuedPlant.name)
            : t("kiosks.add.description")}
        </DialogDescription>

        {issued ? (
          <div className="mt-4">
            <PairingCodeView
              issued={issued}
              plantLabel={issuedPlant?.code ?? ""}
              onIssued={onIssued}
            />
            <DialogFooter className="mt-4">
              <Button variant="outline" onClick={() => close(false)}>
                {t("common.close")}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-4 space-y-4">
            {create.error ? (
              <Alert tone="danger">
                <span>
                  {describeError(create.error, t)}
                  {noGeofence && plant ? (
                    <>
                      {" "}
                      <Link
                        to={`/admin/plants/${plant.id}`}
                        className="font-semibold underline"
                        onClick={() => close(false)}
                      >
                        {t("kiosks.add.drawGeofence")}
                      </Link>
                    </>
                  ) : null}
                </span>
              </Alert>
            ) : null}
            <Field id="kiosk-plant" label={t("kiosks.columns.plant")}>
              <Select
                id="kiosk-plant"
                value={plantId}
                onChange={(event) => setPlantChoice(event.target.value)}
              >
                <option value="">{t("kiosks.add.choosePlant")}</option>
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {plantLabel(item.code, item.name)}
                    {item.geofence_set ? "" : ` – ${t("kiosks.add.noGeofenceOption")}`}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="kiosk-name" label={t("kiosks.add.name")} hint={t("kiosks.add.nameHint")}>
              <Input
                id="kiosk-name"
                value={name}
                maxLength={60}
                autoComplete="off"
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <DialogFooter>
              <Button variant="outline" onClick={() => close(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={!plantId || !name.trim() || create.isPending}>
                {create.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
                {t("kiosks.add.submit")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
