// Day boundaries for reporting periods are computed in the user's IANA time
// zone (sent by the frontend as `tz`), not in UTC: otherwise a purchase made
// on 30.09 at 18:00 in Kyiv (UTC+3) would land in October.

// Same zone the cron jobs use (spec §8, §10); used when the client sends none.
export const DEFAULT_TIME_ZONE = 'Europe/Kyiv';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const dateFormatters = new Map<string, Intl.DateTimeFormat>();
const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();

function formatter(
  cache: Map<string, Intl.DateTimeFormat>,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  let f = cache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone, ...options });
    cache.set(timeZone, f);
  }
  return f;
}

/** Calendar date (YYYY-MM-DD) on which `instant` falls in `timeZone`. */
export function toZonedDate(instant: Date, timeZone: string): string {
  return formatter(dateFormatters, timeZone, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** Offset of `timeZone` from UTC at `instant`, in ms (Kyiv summer: +3h). */
function offsetMs(instant: Date, timeZone: string): number {
  const parts = formatter(dateTimeFormatters, timeZone, {
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value);
  const wallClockAsUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return wallClockAsUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

function parseDate(date: string): [number, number, number] {
  const [y, m, d] = date.split('-').map(Number);
  return [y, m, d];
}

/** UTC instant at which calendar day `date` starts in `timeZone`. */
export function startOfZonedDay(date: string, timeZone: string): Date {
  const [y, m, d] = parseDate(date);
  const midnightAsUtc = Date.UTC(y, m - 1, d);
  // Two passes: the offset at UTC midnight can differ from the offset at
  // local midnight when a DST change happens in between.
  let guess = midnightAsUtc - offsetMs(new Date(midnightAsUtc), timeZone);
  guess = midnightAsUtc - offsetMs(new Date(guess), timeZone);
  return new Date(guess);
}

/** Last millisecond of calendar day `date` in `timeZone`. */
export function endOfZonedDay(date: string, timeZone: string): Date {
  return new Date(startOfZonedDay(addDays(date, 1), timeZone).getTime() - 1);
}

/** `date` (YYYY-MM-DD) shifted by whole calendar days. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = parseDate(date);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Number of calendar days from `from` to `to`, both included. */
export function countDaysInclusive(from: string, to: string): number {
  const [fy, fm, fd] = parseDate(from);
  const [ty, tm, td] = parseDate(to);
  return (
    Math.round(
      (Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000,
    ) + 1
  );
}

/**
 * Calendar date a `from`/`to` query value refers to: a plain date is taken
 * as is, a full timestamp as the day it falls on in `timeZone`.
 */
export function toCalendarDate(value: string, timeZone: string): string {
  return DATE_ONLY.test(value) ? value : toZonedDate(new Date(value), timeZone);
}
