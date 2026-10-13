// "Add a plant" and "Edit details" dialogs (Super Admin). A new plant gets the General shift and
// the four categories from the server; the code can never change after it is saved.
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
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
import { Input, Textarea } from "@/components/ui/input";
import { describeError } from "@/features/auth/error-message";
import { type Plant, useCreatePlant, useUpdatePlant } from "./use-plants";

const schema = z.object({
  name: z.string().trim().min(1, "name.required").max(120),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,10}$/, "plantCode.invalid"),
  address: z.string().trim().max(500),
});
type PlantForm = z.infer<typeof schema>;

type AddProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (plant: Plant) => void;
};

export function AddPlantDialog({ open, onOpenChange, onCreated }: AddProps) {
  const { t } = useTranslation();
  const create = useCreatePlant();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<PlantForm>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", code: "", address: "" },
  });

  const close = (next: boolean) => {
    if (!next) {
      reset();
      create.reset();
    }
    onOpenChange(next);
  };

  const onSubmit = (values: PlantForm) =>
    create.mutate(values, {
      onSuccess: (plant) => {
        close(false);
        onCreated(plant);
      },
    });

  const message = (key?: string) => (key ? t(`validation.${key}`) : undefined);

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogTitle>{t("plants.addDialog.title")}</DialogTitle>
        <DialogDescription>{t("plants.addDialog.description")}</DialogDescription>
        <form onSubmit={handleSubmit(onSubmit)} className="mt-4 space-y-4" noValidate>
          {create.error ? (
            <Alert tone="danger">
              <span>{describeError(create.error, t)}</span>
            </Alert>
          ) : null}
          <Field
            id="plant-code"
            label={t("plants.columns.code")}
            hint={t("plants.addDialog.codeHint")}
            error={message(errors.code?.message)}
          >
            <Input
              id="plant-code"
              autoComplete="off"
              className="code uppercase"
              aria-invalid={Boolean(errors.code)}
              {...register("code")}
            />
          </Field>
          <Field
            id="plant-name"
            label={t("plants.columns.name")}
            error={message(errors.name?.message)}
          >
            <Input
              id="plant-name"
              autoComplete="off"
              aria-invalid={Boolean(errors.name)}
              {...register("name")}
            />
          </Field>
          <Field id="plant-address" label={t("plants.details.address")}>
            <Textarea id="plant-address" rows={2} {...register("address")} />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => close(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? <Loader2 className="animate-spin" /> : null}
              {t("plants.add")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const editSchema = schema.omit({ code: true });
type EditForm = z.infer<typeof editSchema>;

type EditProps = {
  plant: Plant;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function EditPlantDialog({ plant, open, onOpenChange }: EditProps) {
  const { t } = useTranslation();
  const update = useUpdatePlant(plant.id);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<EditForm>({
    resolver: zodResolver(editSchema),
    values: { name: plant.name, address: plant.address },
  });

  const close = (next: boolean) => {
    if (!next) {
      reset();
      update.reset();
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogTitle>{t("plants.editDialog.title", { code: plant.code })}</DialogTitle>
        <DialogDescription>{t("plants.editDialog.description")}</DialogDescription>
        <form
          onSubmit={handleSubmit((values) =>
            update.mutate(values, { onSuccess: () => close(false) }),
          )}
          className="mt-4 space-y-4"
          noValidate
        >
          {update.error ? (
            <Alert tone="danger">
              <span>{describeError(update.error, t)}</span>
            </Alert>
          ) : null}
          <Field
            id="edit-plant-name"
            label={t("plants.columns.name")}
            error={errors.name?.message ? t(`validation.${errors.name.message}`) : undefined}
          >
            <Input id="edit-plant-name" autoComplete="off" {...register("name")} />
          </Field>
          <Field id="edit-plant-address" label={t("plants.details.address")}>
            <Textarea id="edit-plant-address" rows={2} {...register("address")} />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => close(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={update.isPending}>
              {update.isPending ? <Loader2 className="animate-spin" /> : null}
              {t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
