// Plain logic for the shift form: reading "HH:MM" times, the shift length, and whether it ends
// the next day. The server decides `crosses_midnight` itself; this only drives the live sentence.

export const MINUTES_PER_DAY = 24 * 60;

/** "19:00" or "19:00:00" -> 1140 minutes after midnight. */
export function toMinutes(time: string): number {
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

/** 1140 -> "19:00" (wraps past midnight). */
export function fromMinutes(totalMinutes: number): string {
  const wrapped = ((totalMinutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hours = Math.floor(wrapped / 60);
  const minutes = wrapped % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** "07:00:00" from the API -> "07:00" for the form and screens. */
export function shortTime(time: string): string {
  return time.slice(0, 5);
}

/** A shift ends the next day when its end time is earlier than its start (19:00 -> 07:00). */
export function endsNextDay(start: string, end: string): boolean {
  return toMinutes(end) < toMinutes(start);
}

/** Length of the shift in minutes, counting across midnight. Equal times are not a shift. */
export function shiftLengthMinutes(start: string, end: string): number {
  const difference = toMinutes(end) - toMinutes(start);
  return difference > 0 ? difference : difference + MINUTES_PER_DAY;
}

/** 720 -> { hours: 12, minutes: 0 } for "12 h 00 min". */
export function splitMinutes(totalMinutes: number) {
  return { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 };
}
