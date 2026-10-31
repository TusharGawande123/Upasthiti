// The status chip of one attendance day: icon + word + register code, in the colours of the
// approved mockup (design gate B). The same colours colour the cells of the monthly register, so
// colour is never the only cue: every chip and cell also carries its code letters.
import {
  Briefcase,
  CalendarHeart,
  CircleCheck,
  CircleHelp,
  CircleX,
  Contrast,
  Hourglass,
  Loader,
  Moon,
  Sun,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { Day } from "./use-attendance-admin";

export type StatusFamily =
  | "present"
  | "half_day"
  | "short_hours"
  | "absent"
  | "incomplete"
  | "leave"
  | "weekly_off"
  | "holiday"
  | "worked_off_day"
  | "in_progress"
  | "none";

/** Which family (colour, icon, word) a register code belongs to. */
export function familyOfCode(code: string): StatusFamily {
  switch (code) {
    case "P":
      return "present";
    case "HD":
      return "half_day";
    case "SH":
      return "short_hours";
    case "A":
      return "absent";
    case "INC":
      return "incomplete";
    case "PL":
    case "UL":
      return "leave";
    case "WO":
      return "weekly_off";
    case "H":
      return "holiday";
    case "WO-W":
    case "H-W":
      return "worked_off_day";
    case "IN":
    case "OUT":
    case "…":
      return "in_progress";
    default:
      return "none";
  }
}

// Text colour and soft background, straight from the mockup's colour table.
export const FAMILY_COLOURS: Record<StatusFamily, string> = {
  present: "bg-[#e6f5ee] text-[#04694b]",
  half_day: "bg-[#fff3d6] text-[#8f5300]",
  short_hours: "bg-[#ffe9d6] text-[#8a3a00]",
  absent: "bg-[#fdecea] text-[#b42318]",
  incomplete: "border-dashed bg-[#f1e9fb] text-[#5b2c91]",
  leave: "bg-[#eaeefb] text-[#1a3282]",
  weekly_off: "bg-[#eef1f5] text-[#4a5567]",
  holiday: "bg-[#fbf3cf] text-[#5a4a00]",
  worked_off_day: "bg-[#e0f3f5] text-[#0b5560]",
  in_progress: "border-primary bg-white text-primary",
  none: "bg-muted text-muted-foreground",
};

const FAMILY_ICONS = {
  present: CircleCheck,
  half_day: Contrast,
  short_hours: Hourglass,
  absent: CircleX,
  incomplete: CircleHelp,
  leave: CalendarHeart,
  weekly_off: Moon,
  holiday: Sun,
  worked_off_day: Briefcase,
  in_progress: Loader,
  none: CircleX,
} as const;

export function StatusChip({ day }: { day: Pick<Day, "code"> }) {
  const { t } = useTranslation();
  const family = familyOfCode(day.code);
  const Icon = FAMILY_ICONS[family];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-transparent px-2.5 py-1 text-xs font-bold whitespace-nowrap",
        FAMILY_COLOURS[family],
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {t(`attendance.status.${family}`)}
      {family === "in_progress" ? null : (
        <span className="font-mono font-semibold opacity-80">{day.code}</span>
      )}
    </span>
  );
}
