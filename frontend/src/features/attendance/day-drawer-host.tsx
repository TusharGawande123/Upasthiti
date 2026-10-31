// The place where the day drawer is drawn. It reads the `?day=` address (see use-day-drawer.ts) and,
// only when a day is open, loads the drawer code on demand so no page pays for it up front.
import { lazy, Suspense } from "react";
import { useDayDrawer } from "./use-day-drawer";

const DayDrawer = lazy(() =>
  import("./day-drawer").then((module) => ({ default: module.DayDrawer })),
);

export function DayDrawerHost() {
  const { current } = useDayDrawer();
  if (!current) return null;
  return (
    <Suspense fallback={null}>
      <DayDrawer employeeId={current.employeeId} date={current.date} />
    </Suspense>
  );
}
