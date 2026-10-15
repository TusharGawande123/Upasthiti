// Geofence tab: the map, the shape facts, the margin, and the saved versions.
// Saving never changes an old version: it adds a new one (the server keeps the history).
import { Check, Loader2, MapPinOff, TriangleAlert } from "lucide-react";
import { lazy, Suspense, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { describeError } from "@/features/auth/error-message";
import { formatDate, formatNumber, formatTime } from "@/lib/format";
import {
  analyseDraft,
  type Draft,
  MAX_AREA_M2,
  MAX_MARGIN_M,
  MIN_AREA_M2,
  MIN_MARGIN_M,
} from "./geofence-geometry";
import { type Geofence, useGeofenceVersions, useSaveGeofence } from "./use-plants";

// The map code (Leaflet, Geoman, Turf) is large: it loads only when this tab opens.
const GeofenceMap = lazy(() => import("./geofence-map").then((m) => ({ default: m.GeofenceMap })));

function toDraft(geofence: Geofence): Draft {
  return {
    shape: geofence.shape,
    geojson: geofence.geojson,
    radius_m: geofence.radius_m ? Number(geofence.radius_m) : undefined,
  };
}

type Props = { plantId: string; canEdit: boolean };

export function GeofenceTab({ plantId, canEdit }: Props) {
  const { t } = useTranslation();
  const versions = useGeofenceVersions(plantId);
  const save = useSaveGeofence(plantId);
  // The version shown on the map: the current one, or an older one chosen for preview.
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [margin, setMargin] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  // Changing this number rebuilds the map, which throws away an unsaved drawing.
  const [mapResets, setMapResets] = useState(0);

  const current = versions.data?.find((version) => version.is_current) ?? null;
  const previewing = versions.data?.find((version) => version.id === previewId) ?? null;
  const shown = previewing ?? current;
  const savedDraft = useMemo(() => (shown ? toDraft(shown) : null), [shown]);

  if (versions.isPending) return <Skeleton className="h-96 w-full" />;
  if (versions.isError) return <Alert tone="danger">{describeError(versions.error, t)}</Alert>;

  const marginValue = margin ?? current?.buffer_m ?? 25;
  const activeDraft = draft ?? (previewing ? null : savedDraft);
  const analysis = activeDraft ? analyseDraft(activeDraft) : null;
  const marginValid = marginValue >= MIN_MARGIN_M && marginValue <= MAX_MARGIN_M;
  const changed = draft !== null || (current !== null && marginValue !== current.buffer_m);
  const canSave =
    canEdit && activeDraft !== null && analysis?.problem == null && marginValid && changed;

  const submit = () => {
    if (!activeDraft) return;
    save.mutate(
      {
        shape: activeDraft.shape,
        geojson: activeDraft.geojson,
        radius_m: activeDraft.radius_m,
        buffer_m: marginValue,
        reason: reason.trim() || undefined,
      },
      {
        onSuccess: () => {
          setDraft(null);
          setMargin(null);
          setReason("");
          setPreviewId(null);
          setMapResets((count) => count + 1);
        },
      },
    );
  };

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
      <div className="space-y-3">
        {!shown && !canEdit ? (
          <Alert tone="warning">
            <MapPinOff aria-hidden />
            <span>{t("plants.geofence.noneReader")}</span>
          </Alert>
        ) : null}
        {!shown && canEdit ? (
          <Alert tone="info">
            <span>{t("plants.geofence.noneAdmin")}</span>
          </Alert>
        ) : null}
        {previewing ? (
          <Alert tone="info">
            <span>{t("plants.geofence.previewing", { version: previewing.version })}</span>
            <Button
              size="sm"
              variant="outline"
              className="ml-auto"
              onClick={() => setPreviewId(null)}
            >
              {t("plants.geofence.backToCurrent")}
            </Button>
          </Alert>
        ) : null}
        <Suspense fallback={<Skeleton className="h-[460px] w-full" />}>
          <GeofenceMap
            // A different shown version needs a fresh map state for its drawing tools.
            key={`${previewing?.id ?? "current"}-${canEdit && !previewing}-${mapResets}`}
            saved={savedDraft}
            editable={canEdit && !previewing}
            marginM={marginValid ? marginValue : 0}
            onDraftChange={setDraft}
            label={t("plants.geofence.mapLabel")}
          />
        </Suspense>
        {canEdit && !previewing ? (
          <p className="text-[13px] text-muted-foreground">{t("plants.geofence.drawHelp")}</p>
        ) : null}
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>{t("plants.geofence.shape")}</CardTitle>
            {current ? (
              <Badge tone="primary">
                {t("plants.geofence.currentVersion", { version: current.version })}
              </Badge>
            ) : null}
          </CardHeader>
          <CardContent>
            {analysis && activeDraft ? (
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">{t("plants.geofence.type")}</dt>
                  <dd className="font-semibold">
                    {activeDraft.shape === "circle"
                      ? t("plants.geofence.circle", {
                          radius: formatNumber(activeDraft.radius_m ?? 0),
                        })
                      : t("plants.geofence.polygon", { count: analysis.corners })}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">{t("plants.geofence.area")}</dt>
                  <dd className="tnum font-semibold">
                    {formatNumber(Math.round(analysis.areaM2))} m²
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">{t("plants.geofence.allowed")}</dt>
                  <dd className="tnum">
                    {formatNumber(MIN_AREA_M2)} m² – {formatNumber(MAX_AREA_M2 / 1_000_000)} km²
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">{t("plants.geofence.noShape")}</p>
            )}
            {analysis?.problem ? (
              <Alert tone="danger" className="mt-3">
                <TriangleAlert aria-hidden />
                <span>{t(`plants.geofence.problem.${analysis.problem}`)}</span>
              </Alert>
            ) : null}
          </CardContent>
        </Card>

        {canEdit && !previewing ? (
          <Card>
            <CardHeader>
              <CardTitle>{t("plants.geofence.saveTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {save.error ? (
                <Alert tone="danger">
                  <span>{describeError(save.error, t)}</span>
                </Alert>
              ) : null}
              <Field
                id="geofence-margin"
                label={t("plants.geofence.margin")}
                hint={t("plants.geofence.marginHint", { max: MAX_MARGIN_M })}
                error={
                  marginValid ? undefined : t("plants.geofence.marginRange", { max: MAX_MARGIN_M })
                }
              >
                <div className="flex">
                  <Input
                    id="geofence-margin"
                    type="number"
                    min={MIN_MARGIN_M}
                    max={MAX_MARGIN_M}
                    value={marginValue}
                    className="tnum rounded-r-none"
                    onChange={(event) => setMargin(Number(event.target.value))}
                  />
                  <span className="grid place-items-center rounded-r-md border border-l-0 bg-muted px-3 text-sm text-muted-foreground">
                    {t("plants.geofence.metres")}
                  </span>
                </div>
              </Field>
              <Field id="geofence-reason" label={t("plants.geofence.reason")}>
                <Textarea
                  id="geofence-reason"
                  rows={2}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </Field>
              {changed ? (
                <Badge tone="warning">
                  <TriangleAlert aria-hidden />
                  {t("plants.geofence.notSaved")}
                </Badge>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {changed ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setDraft(null);
                      setMargin(null);
                      setPreviewId(null);
                      setMapResets((count) => count + 1);
                    }}
                  >
                    {t("plants.geofence.discard")}
                  </Button>
                ) : null}
                <Button disabled={!canSave || save.isPending} onClick={submit}>
                  {save.isPending ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : (
                    <Check aria-hidden />
                  )}
                  {t("plants.geofence.saveVersion")}
                </Button>
              </div>
              <p className="text-[13px] text-muted-foreground">{t("plants.geofence.saveNote")}</p>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>{t("plants.geofence.history")}</CardTitle>
          </CardHeader>
          <CardContent>
            {versions.data.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("plants.geofence.noHistory")}</p>
            ) : (
              <ul className="divide-y">
                {versions.data.map((version) => (
                  <li key={version.id} className="flex items-center gap-3 py-2 text-sm">
                    <span className="font-bold">v{version.version}</span>
                    <span className="text-muted-foreground">
                      {formatDate(version.created_at)} {formatTime(version.created_at)}
                    </span>
                    {version.is_current ? (
                      <Badge tone="primary" className="ml-auto">
                        {t("plants.geofence.current")}
                      </Badge>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="ml-auto"
                        onClick={() => {
                          setDraft(null);
                          setPreviewId(version.id);
                        }}
                      >
                        {t("plants.geofence.preview")}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
