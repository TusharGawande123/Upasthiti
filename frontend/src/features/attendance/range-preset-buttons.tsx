// The ready-made period buttons of the range views (M5c, F-82): last 7 days, this month ...
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { todayIst } from "@/lib/format";
import { presetRange, RANGE_PRESETS } from "./range-presets";

export function RangePresetButtons({ onPick }: { onPick: (from: string, to: string) => void }) {
  const { t } = useTranslation();
  return (
    <fieldset className="flex flex-wrap gap-2">
      <legend className="sr-only">{t("attendance.register.presets")}</legend>
      {RANGE_PRESETS.map((preset) => (
        <Button
          key={preset}
          variant="outline"
          size="sm"
          onClick={() => {
            const picked = presetRange(preset, todayIst());
            onPick(picked.from, picked.to);
          }}
        >
          {t(`attendance.register.preset.${preset}`)}
        </Button>
      ))}
    </fieldset>
  );
}
