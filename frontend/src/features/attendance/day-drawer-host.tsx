// The place where the day drawer is drawn. For now it reads the `?day=` address (see
// use-day-drawer.ts) and draws nothing: the drawer itself is built in M5 slice 7 group C, which
// replaces this file's body and keeps the same name and props.
import { useDayDrawer } from "./use-day-drawer";

export function DayDrawerHost() {
  const { current } = useDayDrawer();
  void current;
  return null;
}
