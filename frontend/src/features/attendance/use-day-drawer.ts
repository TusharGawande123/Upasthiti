// The one way every screen opens the day drawer (one person, one day): the address gets
// `?day=<employeeId>:<YYYY-MM-DD>`. The register cells, the list rows and (later) the employee
// page only call `openDay`; `DayDrawerHost` reads the same address and draws the drawer.
import { useCallback } from "react";
import { useSearchParams } from "react-router";

export const DAY_PARAM = "day";

export type OpenDay = { employeeId: string; date: string };

/** "e-1:2026-10-29" -> { employeeId: "e-1", date: "2026-10-29" }; anything else -> null. */
export function parseDayParam(value: string | null): OpenDay | null {
  if (!value) return null;
  const [employeeId, date] = value.split(":");
  if (!employeeId || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return { employeeId, date };
}

export function useDayDrawer() {
  const [params, setParams] = useSearchParams();
  const openDay = useCallback(
    (employeeId: string, date: string) => {
      setParams((current) => {
        const next = new URLSearchParams(current);
        next.set(DAY_PARAM, `${employeeId}:${date}`);
        return next;
      });
    },
    [setParams],
  );
  const closeDay = useCallback(() => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.delete(DAY_PARAM);
      return next;
    });
  }, [setParams]);
  return { current: parseDayParam(params.get(DAY_PARAM)), openDay, closeDay };
}
