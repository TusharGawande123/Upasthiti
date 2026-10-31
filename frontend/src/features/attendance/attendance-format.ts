// Small formatting helpers shared by the attendance screens.

/** 465 -> "7 h 45 m". The server sends whole minutes; the screens show hours and minutes. */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours === 0 ? `${rest} m` : `${hours} h ${rest} m`;
}

/** "07:00:00" + 30 minutes -> "07:30" (wraps past midnight for night shifts). */
export function addMinutesToClock(clock: string, minutes: number): string {
  const [hours = 0, mins = 0] = clock.split(":").map(Number);
  const total = (((hours * 60 + mins + minutes) % 1440) + 1440) % 1440;
  const text = (value: number) => String(value).padStart(2, "0");
  return `${text(Math.floor(total / 60))}:${text(total % 60)}`;
}

/** "07:00:00" -> "07:00". */
export function clockText(clock: string): string {
  return addMinutesToClock(clock, 0);
}

/** "2026-10-29" -> "29/10/2026". Attendance days are plain dates, so no time zone is involved. */
export function formatDay(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}
