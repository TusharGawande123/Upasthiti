// Departments and employee categories of a plant: the same simple list (add, rename, switch
// off/on), so one component serves both tabs. Only the Super Admin sees the buttons.
import { Ban, CircleCheck, Pencil, Plus } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { describeError } from "@/features/auth/error-message";
import { ReasonDialog } from "@/features/users/user-dialogs";
import {
  type NamedItem,
  type NamedItemKind,
  useCreateNamedItem,
  useNamedItemAction,
  useNamedItems,
} from "./use-plants";

type Props = { plantId: string; kind: NamedItemKind; canEdit: boolean };

// The name dialog is used for both "add" (no item) and "rename" (an item).
function NameDialog({
  plantId,
  kind,
  item,
  open,
  onOpenChange,
}: {
  plantId: string;
  kind: NamedItemKind;
  item: NamedItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(item?.name ?? "");
  const create = useCreateNamedItem(plantId, kind);
  const rename = useNamedItemAction(kind);
  const mutation = item ? rename : create;
  const trimmed = name.trim();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!trimmed) return;
    const done = { onSuccess: () => onOpenChange(false) };
    if (item) {
      rename.mutate({ id: item.id, rename: trimmed }, done);
    } else {
      create.mutate(trimmed, done);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{t(`plants.${kind}.${item ? "renameTitle" : "addTitle"}`)}</DialogTitle>
        <DialogDescription>{t(`plants.${kind}.description`)}</DialogDescription>
        <form onSubmit={submit} className="mt-4 space-y-4">
          {mutation.error ? (
            <Alert tone="danger">
              <span>{describeError(mutation.error, t)}</span>
            </Alert>
          ) : null}
          <Field id="item-name" label={t("plants.itemName")}>
            <Input
              id="item-name"
              value={name}
              autoComplete="off"
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!trimmed || mutation.isPending}>
              {t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function NamedItemsTab({ plantId, kind, canEdit }: Props) {
  const { t } = useTranslation();
  const items = useNamedItems(plantId, kind);
  const action = useNamedItemAction(kind);
  // `editing` = null: closed; { item: null }: adding; { item }: renaming.
  const [editing, setEditing] = useState<{ item: NamedItem | null } | null>(null);
  const [switching, setSwitching] = useState<NamedItem | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-muted-foreground">{t(`plants.${kind}.description`)}</p>
        {canEdit ? (
          <Button onClick={() => setEditing({ item: null })}>
            <Plus aria-hidden />
            {t(`plants.${kind}.add`)}
          </Button>
        ) : null}
      </div>

      {items.isError ? <Alert tone="danger">{describeError(items.error, t)}</Alert> : null}
      {items.isPending ? <Skeleton className="h-32 w-full" /> : null}

      {items.data ? (
        <Card className="divide-y">
          {items.data.map((item) => (
            <div key={item.id} className="flex items-center gap-3 px-4 py-3">
              <span className="font-semibold">{item.name}</span>
              {item.is_active ? (
                <Badge tone="success">
                  <CircleCheck aria-hidden />
                  {t("plants.status.active")}
                </Badge>
              ) : (
                <Badge tone="neutral">
                  <Ban aria-hidden />
                  {t("plants.status.inactive")}
                </Badge>
              )}
              {canEdit ? (
                <div className="ml-auto flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={t("plants.renameItem", { name: item.name })}
                    onClick={() => setEditing({ item })}
                  >
                    <Pencil className="size-4" aria-hidden />
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setSwitching(item)}>
                    {item.is_active ? t("plants.deactivate") : t("plants.reactivate")}
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
          {items.data.length === 0 ? (
            <p className="p-6 text-center text-muted-foreground">{t(`plants.${kind}.empty`)}</p>
          ) : null}
        </Card>
      ) : null}

      {editing ? (
        <NameDialog
          // A new key resets the typed name for every item.
          key={editing.item?.id ?? "new"}
          plantId={plantId}
          kind={kind}
          item={editing.item}
          open
          onOpenChange={(open) => !open && setEditing(null)}
        />
      ) : null}

      <ReasonDialog
        open={switching !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSwitching(null);
            action.reset();
          }
        }}
        title={
          switching
            ? t(switching.is_active ? "plants.deactivateTitle" : "plants.reactivateTitle", {
                name: switching.name,
              })
            : ""
        }
        confirmLabel={switching?.is_active ? t("plants.deactivate") : t("plants.reactivate")}
        isPending={action.isPending}
        error={action.error ? describeError(action.error, t) : undefined}
        onConfirm={(reason) =>
          switching &&
          action.mutate(
            { id: switching.id, active: !switching.is_active, reason },
            { onSuccess: () => setSwitching(null) },
          )
        }
      />
    </div>
  );
}
