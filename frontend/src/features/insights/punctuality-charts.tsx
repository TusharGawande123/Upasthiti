// The two charts of the punctuality page (Recharts, loaded only with this page): on time each
// week as a line, and on time by weekday as columns. Colour is never the only cue: a weekday
// below 90 % is hatched and marked with a triangle, and the same numbers are in a text list for
// screen readers.
import { useTranslation } from "react-i18next";
import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  Line,
  LineChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import { formatDay } from "@/features/attendance/attendance-format";

export const BELOW_PERCENT = 90;
const PRIMARY = "var(--color-primary)";
const WARNING = "var(--color-warning)";
const AXIS_TEXT = { fontSize: 12, fill: "var(--color-muted-foreground)" };

/** The y axis starts a little below the lowest value so differences stay visible. */
function axisFloor(values: number[]): number {
  const lowest = Math.min(...values, BELOW_PERCENT);
  return Math.max(0, Math.floor((lowest - 5) / 5) * 5);
}

export type WeekPoint = { week_start: string; on_time_percent: number };

export function WeeklyChart({ points }: { points: WeekPoint[] }) {
  const { t } = useTranslation();
  const data = points.map((point) => ({
    label: formatDay(point.week_start).slice(0, 5),
    value: point.on_time_percent,
  }));
  const summary = t("insights.punctuality.chart.weeklyAlt", {
    values: points.map((p) => `${formatDay(p.week_start)} ${p.on_time_percent}%`).join(", "),
  });
  return (
    <figure className="m-0">
      <div role="img" aria-label={summary} className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 22, right: 18, bottom: 4, left: 0 }}>
            <XAxis dataKey="label" tick={AXIS_TEXT} tickLine={false} />
            <YAxis
              domain={[axisFloor(points.map((p) => p.on_time_percent)), 100]}
              tick={AXIS_TEXT}
              tickFormatter={(value: number) => `${value}%`}
              width={42}
              tickLine={false}
            />
            <Line
              type="monotone"
              dataKey="value"
              stroke={PRIMARY}
              strokeWidth={2.5}
              dot={{ r: 4, fill: "white", stroke: PRIMARY, strokeWidth: 2 }}
              isAnimationActive={false}
            >
              <LabelList
                dataKey="value"
                position="top"
                formatter={(value) => `${value}%`}
                style={{ fontSize: 12, fontWeight: 700 }}
              />
            </Line>
          </LineChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="text-center text-xs text-muted-foreground">
        {t("insights.punctuality.chart.weekStart")}
      </figcaption>
      <ul className="sr-only">
        {points.map((point) => (
          <li key={point.week_start}>
            {formatDay(point.week_start)}: {point.on_time_percent}%
          </li>
        ))}
      </ul>
    </figure>
  );
}

export type WeekdayPoint = { name: string; value: number };

export function WeekdayChart({ points }: { points: WeekdayPoint[] }) {
  const { t } = useTranslation();
  const summary = t("insights.punctuality.chart.weekdayAlt", {
    values: points.map((p) => `${p.name} ${p.value}%`).join(", "),
  });
  return (
    <figure className="m-0">
      <div role="img" aria-label={summary} className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={points} margin={{ top: 22, right: 8, bottom: 4, left: 0 }}>
            <defs>
              <pattern
                id="below-ninety"
                width="6"
                height="6"
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(45)"
              >
                <rect width="6" height="6" fill={WARNING} opacity="0.35" />
                <rect width="3" height="6" fill={WARNING} />
              </pattern>
            </defs>
            <XAxis dataKey="name" tick={AXIS_TEXT} tickLine={false} />
            <YAxis
              domain={[axisFloor(points.map((p) => p.value)), 100]}
              tick={AXIS_TEXT}
              tickFormatter={(value: number) => `${value}%`}
              width={42}
              tickLine={false}
            />
            <Bar dataKey="value" radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {points.map((point) => (
                <Cell
                  key={point.name}
                  fill={point.value < BELOW_PERCENT ? "url(#below-ninety)" : PRIMARY}
                />
              ))}
              <LabelList
                dataKey="value"
                position="top"
                formatter={(value) =>
                  Number(value) < BELOW_PERCENT ? `▼ ${value}` : String(value)
                }
                style={{ fontSize: 12, fontWeight: 700 }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ul className="sr-only">
        {points.map((point) => (
          <li key={point.name}>
            {point.name}: {point.value}%
          </li>
        ))}
      </ul>
    </figure>
  );
}
