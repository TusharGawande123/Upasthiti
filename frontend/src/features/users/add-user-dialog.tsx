// "Add user" dialog (spec §4.14): name, username, optional email, role, and a plant only for
// a Plant Head. The server makes a one-time temporary password.
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
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { describeError } from "@/features/auth/error-message";
import { usePlants } from "@/features/plants/use-plants";
import { useCreateUser } from "./use-users";

const schema = z
  .object({
    name: z.string().trim().min(1, "name.required"),
    username: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9._]{3,30}$/, "username.invalid"),
    email: z.string().trim(),
    role: z.enum(["super_admin", "corporate_head", "plant_head"]),
    plant_id: z.string(),
  })
  .refine((values) => values.role !== "plant_head" || values.plant_id !== "", {
    path: ["plant_id"],
    message: "plant.required",
  });
type AddUserForm = z.infer<typeof schema>;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (name: string, temporaryPassword: string) => void;
};

export function AddUserDialog({ open, onOpenChange, onCreated }: Props) {
  const { t } = useTranslation();
  const plants = usePlants({ is_active: true });
  const create = useCreateUser();
  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors },
  } = useForm<AddUserForm>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", username: "", email: "", role: "corporate_head", plant_id: "" },
  });
  const role = watch("role");

  const close = (next: boolean) => {
    if (!next) {
      reset();
      create.reset();
    }
    onOpenChange(next);
  };

  const onSubmit = (values: AddUserForm) =>
    create.mutate(
      {
        name: values.name,
        username: values.username,
        email: values.email || undefined,
        role: values.role,
        plant_id: values.role === "plant_head" ? values.plant_id : undefined,
      },
      {
        onSuccess: (result) => {
          onCreated(result.user.name, result.temporary_password);
          close(false);
        },
      },
    );

  const message = (key?: string) => (key ? t(`validation.${key}`) : undefined);

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogTitle>{t("users.addDialog.title")}</DialogTitle>
        <DialogDescription>{t("users.addDialog.description")}</DialogDescription>
        <form onSubmit={handleSubmit(onSubmit)} className="mt-4 space-y-4" noValidate>
          {create.error ? (
            <Alert tone="danger">
              <span>{describeError(create.error, t)}</span>
            </Alert>
          ) : null}
          <Field id="name" label={t("users.addDialog.name")} error={message(errors.name?.message)}>
            <Input
              id="name"
              autoComplete="off"
              aria-invalid={Boolean(errors.name)}
              {...register("name")}
            />
          </Field>
          <Field
            id="username"
            label={t("users.addDialog.username")}
            hint={t("users.addDialog.usernameHint")}
            error={message(errors.username?.message)}
          >
            <Input
              id="username"
              autoComplete="off"
              className="code"
              aria-invalid={Boolean(errors.username)}
              {...register("username")}
            />
          </Field>
          <Field
            id="email"
            label={t("users.addDialog.email")}
            hint={t("users.addDialog.emailHint")}
          >
            <Input id="email" type="email" autoComplete="off" {...register("email")} />
          </Field>
          <Field id="role" label={t("users.columns.role")}>
            <Select id="role" {...register("role")}>
              <option value="super_admin">{t("roles.super_admin")}</option>
              <option value="corporate_head">{t("roles.corporate_head")}</option>
              <option value="plant_head">{t("roles.plant_head")}</option>
            </Select>
          </Field>
          {role === "plant_head" ? (
            <Field
              id="plant_id"
              label={t("users.columns.plant")}
              error={message(errors.plant_id?.message)}
            >
              <Select
                id="plant_id"
                aria-invalid={Boolean(errors.plant_id)}
                {...register("plant_id")}
              >
                <option value="">{t("users.addDialog.choosePlant")}</option>
                {plants.data?.items.map((plant) => (
                  <option key={plant.id} value={plant.id}>
                    {plant.code} – {plant.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => close(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? <Loader2 className="animate-spin" /> : null}
              {t("users.addDialog.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
