// The Kiosks tab inside a plant: the plant's kiosks and a button to add one for this plant.
import { Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { describeError } from "@/features/auth/error-message";
import { formatDate, formatTime } from "@/lib/format";
import { AddKioskDialog } from "./add-kiosk-dialog";
import { KioskStatusBadge } from "./kiosks-page";
import { type KioskWithCode, useKiosks } from "./use-kiosks";

type Props = { plantId: string; canManage: boolean };

export function PlantKiosksTab({ plantId, canManage }: Props) {
  const { t } = useTranslation();
  const kiosks = useKiosks({ plant_id: plantId });
  const [adding, setAdding] = useState(false);
  const [issued, setIssued] = useState<KioskWithCode | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-muted-foreground">{t("kiosks.plantTab.description")}</p>
        <div className="flex gap-2">
          <Link
            to="/admin/kiosks"
            className="inline-flex h-10 items-center rounded-md px-3 text-sm font-semibold text-primary underline"
          >
            {t("kiosks.plantTab.all")}
          </Link>
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
      </div>

      {kiosks.isError ? <Alert tone="danger">{describeError(kiosks.error, t)}</Alert> : null}
      {kiosks.isPending ? <Skeleton className="h-24 w-full" /> : null}

      {kiosks.data ? (
        <Card className="divide-y">
          {kiosks.data.map((kiosk) => (
            <div key={kiosk.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="font-semibold">{kiosk.name}</span>
              <KioskStatusBadge status={kiosk.status} />
              <span className="tnum ml-auto text-sm text-muted-foreground">
                {kiosk.last_seen_at
                  ? `${formatDate(kiosk.last_seen_at)}, ${formatTime(kiosk.last_seen_at)}`
                  : t("kiosks.never")}
              </span>
            </div>
          ))}
          {kiosks.data.length === 0 ? (
            <p className="p-6 text-center text-muted-foreground">{t("kiosks.plantTab.empty")}</p>
          ) : null}
        </Card>
      ) : null}

      <AddKioskDialog
        open={adding}
        onOpenChange={setAdding}
        issued={issued}
        onIssued={setIssued}
        defaultPlantId={plantId}
      />
    </div>
  );
}
