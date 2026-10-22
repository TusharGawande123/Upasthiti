// Kiosks page: every phone, tablet or PC paired at a plant gate, with status, accuracy at
// pairing and last seen. Super Admin and the Plant Head of the plant add, rename and revoke;
// a Corporate Head only views.
import { Ban, CircleCheck, Hourglass, Pencil, Plus, RefreshCw, Tablet } from "lucide-react";
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
import { Select } from "@/components/ui/select";
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
import { usePlants } from "@/features/plants/use-plants";
import { ReasonDialog } from "@/features/users/user-dialogs";
import { formatDate, formatTime } from "@/lib/format";
import { AddKioskDialog } from "./add-kiosk-dialog";
import { LastSelfTest, SoundSwitch } from "./sound-switch";
import {
  type Kiosk,
  type KioskStatus,
  type KioskWithCode,
  useKiosks,
  useNewPairingCode,
  useRenameKiosk,
  useRevokeKiosk,
} from "./use-kiosks";

export function KioskStatusBadge({ status }: { status: KioskStatus }) {
  const { t } = useTranslation();
  if (status === "active") {
    return (
      <Badge tone="success">
        <CircleCheck aria-hidden />
        {t("kiosks.status.active")}
      </Badge>
    );
  }
  if (status === "pending") {
    return (
      <Badge tone="warning">
        <Hourglass aria-hidden />
        {t("kiosks.status.pending")}
      </Badge>
    );
  }
  return (
    <Badge tone="neutral">
      <Ban aria-hidden />
      {t("kiosks.status.revoked")}
    </Badge>
  );
}

function RenameDialog({ kiosk, onClose }: { kiosk: Kiosk; onClose: () => void }) {
  const { t } = useTranslation();
  const rename = useRenameKiosk();
  const [name, setName] = useState(kiosk.name);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogTitle>{t("kiosks.rename.title")}</DialogTitle>
        <DialogDescription>{kiosk.name}</DialogDescription>
        <form
          className="mt-4 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim())
              rename.mutate({ id: kiosk.id, name: name.trim() }, { onSuccess: onClose });
          }}
        >
          {rename.error ? (
            <Alert tone="danger">
              <span>{describeError(rename.error, t)}</span>
            </Alert>
          ) : null}
          <Field id="rename-kiosk" label={t("kiosks.add.name")}>
            <Input
              id="rename-kiosk"
              value={name}
              maxLength={60}
              autoComplete="off"
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!name.trim() || rename.isPending}>
              {t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function KiosksPage() {
  const { t } = useTranslation();
  const me = useMe();
  const canManage = me.data?.role === "super_admin" || me.data?.role === "plant_head";
  const [plantId, setPlantId] = useState("");
  const [status, setStatus] = useState<KioskStatus | "">("");
  const kiosks = useKiosks({ plant_id: plantId || undefined, status: status || undefined });
  const plants = usePlants();
  const revoke = useRevokeKiosk();
  const newCode = useNewPairingCode();

  const [adding, setAdding] = useState(false);
  const [issued, setIssued] = useState<KioskWithCode | null>(null);
  const [renaming, setRenaming] = useState<Kiosk | null>(null);
  const [revoking, setRevoking] = useState<Kiosk | null>(null);

  const plantOf = (id: string) => plants.data?.items.find((plant) => plant.id === id);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">{t("kiosks.title")}</h1>
          <p className="max-w-xl text-sm text-muted-foreground">{t("kiosks.subtitle")}</p>
        </div>
        {canManage ? (
          <Button
            onClick={() => {
              setIssued(null);
              setAdding(true);
            }}
          >
            <Plus aria-hidden />
            {t("kiosks.add.button")}
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-3">
        <Select
          aria-label={t("kiosks.columns.plant")}
          value={plantId}
          onChange={(event) => setPlantId(event.target.value)}
          className="w-auto"
        >
          <option value="">{t("kiosks.filter.allPlants")}</option>
          {plants.data?.items.map((plant) => (
            <option key={plant.id} value={plant.id}>
              {plant.code} · {plant.name}
            </option>
          ))}
        </Select>
        <Select
          aria-label={t("kiosks.columns.status")}
          value={status}
          onChange={(event) => setStatus(event.target.value as KioskStatus | "")}
          className="w-auto"
        >
          <option value="">{t("kiosks.filter.anyStatus")}</option>
          <option value="active">{t("kiosks.status.active")}</option>
          <option value="pending">{t("kiosks.status.pending")}</option>
          <option value="revoked">{t("kiosks.status.revoked")}</option>
        </Select>
      </div>

      {kiosks.isError ? (
        <Alert tone="danger">
          <span>{describeError(kiosks.error, t)}</span>
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => kiosks.refetch()}>
            {t("common.tryAgain")}
          </Button>
        </Alert>
      ) : null}
      {newCode.error ? <Alert tone="danger">{describeError(newCode.error, t)}</Alert> : null}

      {kiosks.isPending ? <Skeleton className="h-40 w-full" /> : null}

      {kiosks.data && kiosks.data.length === 0 ? (
        <Card className="p-10 text-center">
          <Tablet className="mx-auto size-10 text-muted-foreground" aria-hidden />
          <h2 className="mt-3 text-lg font-bold">{t("kiosks.empty.title")}</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            {t("kiosks.empty.text")}
          </p>
        </Card>
      ) : null}

      {kiosks.data && kiosks.data.length > 0 ? (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>{t("kiosks.columns.kiosk")}</TableHead>
                <TableHead>{t("kiosks.columns.plant")}</TableHead>
                <TableHead>{t("kiosks.columns.status")}</TableHead>
                <TableHead>{t("kiosks.columns.accuracy")}</TableHead>
                <TableHead>{t("kiosks.columns.lastSeen")}</TableHead>
                <TableHead>{t("kiosks.columns.lastSelfTest")}</TableHead>
                <TableHead>{t("kiosks.columns.sound")}</TableHead>
                <TableHead>
                  <span className="sr-only">{t("common.actions")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {kiosks.data.map((kiosk) => {
                const plant = plantOf(kiosk.plant_id);
                return (
                  <TableRow key={kiosk.id}>
                    <TableCell className="font-semibold">{kiosk.name}</TableCell>
                    <TableCell>
                      <span className="code block">{plant?.code ?? "–"}</span>
                      <span className="block text-xs text-muted-foreground">{plant?.name}</span>
                    </TableCell>
                    <TableCell>
                      <KioskStatusBadge status={kiosk.status} />
                      {kiosk.status === "revoked" && kiosk.revoke_reason ? (
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {kiosk.revoke_reason}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="tnum">
                      {kiosk.registered_accuracy_m
                        ? `± ${Math.round(Number(kiosk.registered_accuracy_m))} m`
                        : "–"}
                    </TableCell>
                    <TableCell className="tnum text-muted-foreground">
                      {kiosk.last_seen_at
                        ? `${formatDate(kiosk.last_seen_at)}, ${formatTime(kiosk.last_seen_at)}`
                        : t("kiosks.never")}
                    </TableCell>
                    <TableCell>
                      <LastSelfTest kiosk={kiosk} />
                    </TableCell>
                    <TableCell>
                      <SoundSwitch kiosk={kiosk} canManage={canManage} />
                    </TableCell>
                    <TableCell>
                      {canManage && kiosk.status !== "revoked" ? (
                        <div className="flex justify-end gap-1">
                          {kiosk.status === "pending" ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={newCode.isPending}
                              onClick={() =>
                                newCode.mutate(kiosk.id, {
                                  onSuccess: (result) => {
                                    setIssued(result);
                                    setAdding(true);
                                  },
                                })
                              }
                            >
                              <RefreshCw className="size-4" aria-hidden />
                              {t("kiosks.newCode")}
                            </Button>
                          ) : null}
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={t("kiosks.rename.for", { name: kiosk.name })}
                            onClick={() => setRenaming(kiosk)}
                          >
                            <Pencil className="size-4" aria-hidden />
                          </Button>
                          <Button size="sm" variant="danger" onClick={() => setRevoking(kiosk)}>
                            {t("kiosks.revoke.button")}
                          </Button>
                        </div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      ) : null}

      <AddKioskDialog
        open={adding}
        onOpenChange={setAdding}
        issued={issued}
        onIssued={setIssued}
        defaultPlantId={plantId || undefined}
      />
      {renaming ? <RenameDialog kiosk={renaming} onClose={() => setRenaming(null)} /> : null}
      <ReasonDialog
        open={revoking !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRevoking(null);
            revoke.reset();
          }
        }}
        title={revoking ? t("kiosks.revoke.title", { name: revoking.name }) : ""}
        confirmLabel={t("kiosks.revoke.button")}
        isPending={revoke.isPending}
        error={revoke.error ? describeError(revoke.error, t) : undefined}
        onConfirm={(reason) =>
          revoking &&
          revoke.mutate({ id: revoking.id, reason }, { onSuccess: () => setRevoking(null) })
        }
      />
    </div>
  );
}
