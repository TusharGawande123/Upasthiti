// Turns the `?show=` word of a dashboard tile link into the attendance list's own filters
// (spec M5 §4.1). The list can only filter by status and by "has exceptions", so a tile that
// counts something else (for example "late") is shown as its closest list and says so.

export type ShowFilter = {
  status?: string;
  hasExceptions?: boolean;
  // False when the list is only the closest match of the tile's number.
  exact: boolean;
};

const SHOW_FILTERS: Record<string, ShowFilter> = {
  // Everyone whose day is still open (inside, not arrived or already left).
  inside: { status: "open", exact: false },
  not_arrived: { status: "open", exact: false },
  // Everyone the server expects, arrived or late: the whole day, no narrower filter exists.
  expected: { exact: false },
  arrived: { exact: false },
  late: { exact: false },
  on_leave: { status: "leave", exact: true },
  off_today: { status: "weekly_off", exact: false },
  exceptions: { hasExceptions: true, exact: true },
  to_decide: { status: "short_hours", exact: false },
};

export function filtersForShow(show: string | null): ShowFilter | null {
  return show ? (SHOW_FILTERS[show] ?? null) : null;
}
