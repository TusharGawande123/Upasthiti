// Small controls shared by the live dashboard and the emergency muster: the plant picker (the
// same plant filter as the top bar, so it is remembered), the demo-plants switch and its chip.
import { FlaskConical } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PlantFilterSelect } from "@/app/layouts/plant-filter";

export function PlantPicker() {
  return <PlantFilterSelect />;
}

/** "Show demo plants": Super Admin only, saved in this browser. */
export function DemoSwitch({ on, onChange }: { on: boolean; onChange: (next: boolean) => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      title={t("dashboard.live.demoSwitchHint")}
      onClick={() => onChange(!on)}
      className="flex h-10 cursor-pointer items-center gap-2 rounded-md border bg-card px-3 text-sm font-semibold"
    >
      <span
        aria-hidden
        className={`flex h-5 w-9 items-center rounded-full p-0.5 ${on ? "bg-primary" : "bg-border-strong"}`}
      >
        <span
          className={`size-4 rounded-full bg-white transition-transform ${on ? "translate-x-4" : ""}`}
        />
      </span>
      {t("dashboard.live.demoSwitch")}
    </button>
  );
}

export function DemoChip() {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-warning bg-warning-soft px-3 py-1 text-sm font-bold text-warning">
      <FlaskConical className="size-4" aria-hidden />
      {t("dashboard.live.demoChip")}
    </span>
  );
}
