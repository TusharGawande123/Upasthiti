// Contractors page: the company-wide list of agencies that supply temporary workers. Everyone
// reads it; only the Super Admin adds, edits and switches agencies off. An agency with active
// workers cannot be switched off (the server refuses with CONTRACTOR_IN_USE).
import { Ban, CircleCheck, HardHat, Pencil, Plus } from "lucide-react";
import { useState } from "react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { describeError } from "@/features/auth/error-message";
import { useMe } from "@/features/auth/use-auth";
import { ReasonDialog } from "@/features/users/user-dialogs";
import { formatNumber } from "@/lib/format";
import {
  type Contractor,
  useContractorActiveToggle,
  useContractors,
  useSaveContractor,
} from "./use-contractors";

const PHONE_PATTERN = /^[0-9+ -]*$/;

function ContractorDialog({
  contractor,
  onClose,
}: {
  contractor: Contractor | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const save = useSaveContractor();
  const [name, setName] = useState(contractor?.name ?? "");
  const [contactName, setContactName] = useState(contractor?.contact_name ?? "");
  const [phone, setPhone] = useState(contractor?.contact_phone ?? "");
  const phoneValid = PHONE_PATTERN.test(phone);
  const valid = name.trim() !== "" && phoneValid;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogTitle>
          {t(contractor ? "contractors.editTitle" : "contractors.addTitle")}
        </DialogTitle>
        <DialogDescription>{t("contractors.dialogNote")}</DialogDescription>
        <form
          className="mt-4 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!valid) return;
            save.mutate(
              {
                id: contractor?.id,
                input: {
                  name: name.trim(),
                  contact_name: contactName.trim() || null,
                  contact_phone: phone.trim() || null,
                },
              },
              { onSuccess: onClose },
            );
          }}
        >
          {save.error ? (
            <Alert tone="danger">
              <span>{describeError(save.error, t)}</span>
            </Alert>
          ) : null}
          <Field id="contractor-name" label={t("contractors.columns.name")}>
            <Input
              id="contractor-name"
              value={name}
              maxLength={120}
              autoComplete="off"
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field id="contractor-contact" label={t("contractors.contactName")}>
            <Input
              id="contractor-contact"
              value={contactName}
              maxLength={120}
              autoComplete="off"
              onChange={(event) => setContactName(event.target.value)}
            />
          </Field>
          <Field
            id="contractor-phone"
            label={t("contractors.officePhone")}
            hint={t("contractors.phoneHint")}
            error={phoneValid ? undefined : t("contractors.phoneInvalid")}
          >
            <Input
              id="contractor-phone"
              value={phone}
              maxLength={20}
              autoComplete="off"
              onChange={(event) => setPhone(event.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!valid || save.isPending}>
              {t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ContractorsPage() {
  const { t } = useTranslation();
  const me = useMe();
  const canManage = me.data?.role === "super_admin";
  const contractors = useContractors();
  const toggle = useContractorActiveToggle();
  // `editing` = null: closed; { contractor: null }: adding; { contractor }: editing.
  const [editing, setEditing] = useState<{ contractor: Contractor | null } | null>(null);
  const [switching, setSwitching] = useState<Contractor | null>(null);

  const list = contractors.data ?? [];
  const activeAgencies = list.filter((item) => item.is_active).length;
  const workers = list.reduce((sum, item) => sum + item.active_workers, 0);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">{t("contractors.title")}</h1>
          <p className="max-w-xl text-sm text-muted-foreground">{t("contractors.subtitle")}</p>
        </div>
        {canManage ? (
          <Button onClick={() => setEditing({ contractor: null })}>
            <Plus aria-hidden />
            {t("contractors.add")}
          </Button>
        ) : null}
      </div>

      {contractors.isError ? (
        <Alert tone="danger">
          <span>{describeError(contractors.error, t)}</span>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            onClick={() => contractors.refetch()}
          >
            {t("common.tryAgain")}
          </Button>
        </Alert>
      ) : null}
      {contractors.isPending ? <Skeleton className="h-40 w-full" /> : null}

      {contractors.data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Card className="p-4">
              <span className="tnum block text-2xl font-bold">{formatNumber(activeAgencies)}</span>
              <span className="text-[13px] text-muted-foreground">
                {t("contractors.summary.agencies")}
              </span>
            </Card>
            <Card className="p-4">
              <span className="tnum block text-2xl font-bold">{formatNumber(workers)}</span>
              <span className="text-[13px] text-muted-foreground">
                {t("contractors.summary.workers")}
              </span>
            </Card>
          </div>

          {list.length === 0 ? (
            <Card className="p-10 text-center">
              <HardHat className="mx-auto size-10 text-muted-foreground" aria-hidden />
              <h2 className="mt-3 text-lg font-bold">{t("contractors.empty.title")}</h2>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                {t("contractors.empty.text")}
              </p>
            </Card>
          ) : (
            <Card className="overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>{t("contractors.columns.name")}</TableHead>
                    <TableHead>{t("contractors.contactName")}</TableHead>
                    <TableHead>{t("contractors.officePhone")}</TableHead>
                    <TableHead className="text-right">{t("contractors.columns.workers")}</TableHead>
                    <TableHead>{t("contractors.columns.status")}</TableHead>
                    <TableHead>
                      <span className="sr-only">{t("common.actions")}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-semibold">{item.name}</TableCell>
                      <TableCell>{item.contact_name ?? "–"}</TableCell>
                      <TableCell className="tnum">{item.contact_phone ?? "–"}</TableCell>
                      <TableCell className="tnum text-right font-semibold">
                        {formatNumber(item.active_workers)}
                      </TableCell>
                      <TableCell>
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
                      </TableCell>
                      <TableCell>
                        {canManage ? (
                          <div className="flex justify-end gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label={t("contractors.edit", { name: item.name })}
                              onClick={() => setEditing({ contractor: item })}
                            >
                              <Pencil className="size-4" aria-hidden />
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => setSwitching(item)}>
                              {item.is_active ? t("plants.deactivate") : t("plants.reactivate")}
                            </Button>
                          </div>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </>
      ) : null}

      {editing ? (
        <ContractorDialog
          key={editing.contractor?.id ?? "new"}
          contractor={editing.contractor}
          onClose={() => setEditing(null)}
        />
      ) : null}

      <ReasonDialog
        open={switching !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSwitching(null);
            toggle.reset();
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
        isPending={toggle.isPending}
        error={toggle.error ? describeError(toggle.error, t) : undefined}
        onConfirm={(reason) =>
          switching &&
          toggle.mutate(
            { id: switching.id, active: !switching.is_active, reason },
            { onSuccess: () => setSwitching(null) },
          )
        }
      />
    </div>
  );
}
