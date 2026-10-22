// The photo dialog of the punch log (Super Admin only, spec §4.10, design gate C): the 320 px
// photo enlarged, with Older / Newer to step through the photos of the list, and "Compare with
// earlier punches" showing the same card's last 3 photos beside it. Every photo shown is one
// audited view on the server, and the dialog says so.
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Columns2,
  Eye,
  ImageOff,
  Loader2,
  Moon,
  ServerCrash,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, formatTimeWithSeconds } from "@/lib/format";
import { PunchResultText } from "./punch-cells";
import { type PunchItem, useComparison, usePunchPhoto } from "./use-punches";

function whenAndWhere(punch: PunchItem): string {
  return `${formatDate(punch.server_received_at)} ${formatTimeWithSeconds(punch.server_received_at)} · ${punch.kiosk.name}`;
}

// The reasons a photo cannot be shown, each in plain words.
const PHOTO_PROBLEMS: Record<string, { icon: typeof ImageOff; key: string }> = {
  SNAPSHOT_PURGED: { icon: Trash2, key: "punches.photo.purged" },
  SNAPSHOT_NOT_AVAILABLE: { icon: ImageOff, key: "punches.photo.notAvailable" },
  STORAGE_UNAVAILABLE: { icon: ServerCrash, key: "punches.photo.storageDown" },
};

/** One photo (loaded and audited once) with a text fallback when it cannot be shown. */
export function PunchPhoto({ punch }: { punch: PunchItem }) {
  const { t } = useTranslation();
  const photo = usePunchPhoto(punch.id);
  const size = "aspect-[4/3] w-full";

  if (photo.status === "loading") {
    return (
      <div className={`${size} grid place-items-center rounded-lg bg-muted`} role="status">
        <Loader2 className="size-8 animate-spin text-muted-foreground" aria-hidden />
        <span className="sr-only">{t("punches.photo.loading")}</span>
      </div>
    );
  }
  if (photo.status === "error") {
    const problem = PHOTO_PROBLEMS[photo.code] ?? PHOTO_PROBLEMS.SNAPSHOT_NOT_AVAILABLE;
    const Icon = problem?.icon ?? ImageOff;
    return (
      <div
        className={`${size} flex flex-col items-center justify-center gap-2 rounded-lg border bg-muted p-4 text-center`}
        role="alert"
      >
        <Icon className="size-8 text-muted-foreground" aria-hidden />
        <p className="text-sm font-semibold">{t(problem?.key ?? "punches.photo.notAvailable")}</p>
      </div>
    );
  }
  return (
    <img
      src={photo.url}
      alt={t("punches.photo.alt", { when: whenAndWhere(punch) })}
      className={`${size} rounded-lg border object-cover`}
    />
  );
}

function PhotoView({
  punch,
  hasOlder,
  hasNewer,
  onOlder,
  onNewer,
  onCompare,
  onClose,
}: {
  punch: PunchItem;
  hasOlder: boolean;
  hasNewer: boolean;
  onOlder: () => void;
  onNewer: () => void;
  onCompare: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const canCompare = punch.employee !== null || punch.snapshot.state === "stored";
  return (
    <>
      <DialogTitle className="flex items-center gap-2">
        <Eye className="size-5" aria-hidden />
        {t("punches.photo.title")}
      </DialogTitle>
      <DialogDescription>{whenAndWhere(punch)}</DialogDescription>
      <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_14rem]">
        <PunchPhoto punch={punch} />
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="text-muted-foreground">{t("punches.columns.employee")}</dt>
            <dd className="font-semibold">
              {punch.employee ? (
                <>
                  {punch.employee.name}
                  <span className="code block text-xs font-normal text-muted-foreground">
                    {punch.employee.code}
                  </span>
                </>
              ) : (
                t("punches.unknownCard")
              )}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("punches.columns.result")}</dt>
            <dd>
              <PunchResultText punch={punch} />
            </dd>
          </div>
          {punch.snapshot.is_dark ? (
            <div>
              <Badge tone="neutral">
                <Moon aria-hidden />
                {t("punches.darkPhoto")}
              </Badge>
            </div>
          ) : null}
        </dl>
      </div>
      <Alert tone="info" className="mt-4">
        <Eye aria-hidden />
        <span>{t("punches.photo.audited")}</span>
      </Alert>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={!hasNewer} onClick={onNewer}>
          <ChevronLeft aria-hidden />
          {t("punches.photo.newer")}
        </Button>
        <Button size="sm" variant="outline" disabled={!hasOlder} onClick={onOlder}>
          {t("punches.photo.older")}
          <ChevronRight aria-hidden />
        </Button>
        <span className="ml-auto flex gap-2">
          {canCompare ? (
            <Button size="sm" variant="outline" onClick={onCompare}>
              <Columns2 aria-hidden />
              {t("punches.photo.compare")}
            </Button>
          ) : null}
          <Button size="sm" onClick={onClose}>
            {t("common.close")}
          </Button>
        </span>
      </div>
    </>
  );
}

function CompareView({
  punch,
  onBack,
  onClose,
}: {
  punch: PunchItem;
  onBack: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const comparison = useComparison(punch.id);
  const earlier = comparison.data?.earlier ?? [];
  return (
    <>
      <DialogTitle className="flex items-center gap-2">
        <Columns2 className="size-5" aria-hidden />
        {punch.employee
          ? t("punches.compare.titleFor", {
              name: punch.employee.name,
              code: punch.employee.code,
            })
          : t("punches.compare.title")}
      </DialogTitle>
      <DialogDescription>{t("punches.compare.explain")}</DialogDescription>
      {comparison.isPending ? (
        <Skeleton className="mt-4 h-48 w-full" />
      ) : (
        <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <section aria-label={t("punches.compare.thisPunch")}>
            <h3 className="mb-2 text-xs font-bold text-muted-foreground uppercase">
              {t("punches.compare.thisPunch")}
            </h3>
            <PunchPhoto punch={punch} />
            <p className="mt-1 text-xs text-muted-foreground">{whenAndWhere(punch)}</p>
          </section>
          <section aria-label={t("punches.compare.earlier", { count: earlier.length })}>
            <h3 className="mb-2 text-xs font-bold text-muted-foreground uppercase">
              {t("punches.compare.earlier", { count: earlier.length })}
            </h3>
            {earlier.length === 0 ? (
              <p className="rounded-lg border bg-muted p-4 text-sm">{t("punches.compare.none")}</p>
            ) : (
              <ul className="grid grid-cols-3 gap-3">
                {earlier.map((item) => (
                  <li key={item.id}>
                    <PunchPhoto punch={item} />
                    <p className="tnum mt-1 text-xs font-semibold">
                      {formatDate(item.server_received_at)}{" "}
                      {formatTimeWithSeconds(item.server_received_at)}
                    </p>
                    <p className="text-xs text-muted-foreground">{item.kiosk.name}</p>
                    <PunchResultText punch={item} small />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
      {comparison.isError ? (
        <Alert tone="danger" className="mt-4">
          <span>{t("punches.compare.failed")}</span>
        </Alert>
      ) : null}
      <Alert tone="info" className="mt-4">
        <Eye aria-hidden />
        <span>{t("punches.compare.audited", { count: 1 + earlier.length })}</span>
      </Alert>
      <div className="mt-4 flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={onBack}>
          <ArrowLeft aria-hidden />
          {t("punches.compare.back")}
        </Button>
        <span className="ml-auto flex gap-2">
          {punch.employee ? (
            <Link
              to={`/admin/employees/${punch.employee.id}`}
              className={buttonVariants({ size: "sm", variant: "outline" })}
            >
              {t("punches.compare.openEmployee")}
            </Link>
          ) : null}
          <Button size="sm" onClick={onClose}>
            {t("common.close")}
          </Button>
        </span>
      </div>
    </>
  );
}

/**
 * `punches` are the rows of the list that have a stored photo, newest first: Older goes to the
 * next row, Newer to the one before. Each step is a new view, so a new audit entry.
 */
export function PhotoDialog({
  punches,
  startId,
  startComparing = false,
  onClose,
}: {
  punches: PunchItem[];
  startId: string;
  startComparing?: boolean;
  onClose: () => void;
}) {
  const [currentId, setCurrentId] = useState(startId);
  const [comparing, setComparing] = useState(startComparing);
  const index = Math.max(
    0,
    punches.findIndex((punch) => punch.id === currentId),
  );
  const punch = punches[index];
  if (!punch) return null;

  const go = (offset: number) => {
    const target = punches[index + offset];
    if (target) setCurrentId(target.id);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={comparing ? "max-w-4xl" : "max-w-2xl"}>
        {comparing ? (
          <CompareView punch={punch} onBack={() => setComparing(false)} onClose={onClose} />
        ) : (
          <PhotoView
            punch={punch}
            hasOlder={index < punches.length - 1}
            hasNewer={index > 0}
            onOlder={() => go(1)}
            onNewer={() => go(-1)}
            onCompare={() => setComparing(true)}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
