// Business dates are plain ISO strings (YYYY-MM-DD). All arithmetic is done in UTC on those
// strings so the browser's own timezone can never shift a date.

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function toUtc(iso: string): Date | null {
  const match = ISO_DATE.exec(iso);
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  // Reject overflow such as 2026-02-30, which Date silently rolls into March.
  return date.toISOString().slice(0, 10) === iso ? date : null;
}

export function isValidIsoDate(value: string | null | undefined): value is string {
  return typeof value === 'string' && toUtc(value) !== null;
}

function mustParse(iso: string): Date {
  const date = toUtc(iso);
  if (!date) throw new RangeError(`Invalid ISO date: ${iso}`);
  return date;
}

export function addDays(iso: string, days: number): string {
  const date = mustParse(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function format(iso: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...options }).format(mustParse(iso));
}

export const weekdayShort = (iso: string) => format(iso, { weekday: 'short' });
export const monthDay = (iso: string) => format(iso, { month: 'short', day: 'numeric' });
export const longDate = (iso: string) =>
  format(iso, { weekday: 'long', month: 'long', day: 'numeric' });

/** "Oct 19 – Oct 25, 2026", or with both years when the week spans a year boundary. */
export function formatWeekRange(startIso: string, endIso: string): string {
  const startYear = mustParse(startIso).getUTCFullYear();
  const endYear = mustParse(endIso).getUTCFullYear();
  if (startYear === endYear) {
    return `${monthDay(startIso)} – ${monthDay(endIso)}, ${endYear}`;
  }
  const full = (iso: string) => format(iso, { month: 'short', day: 'numeric', year: 'numeric' });
  return `${full(startIso)} – ${full(endIso)}`;
}

/** 0 = Sunday … 6 = Saturday, from the calendar date itself (no timezone involved). */
export function weekdayIndex(iso: string): number {
  return mustParse(iso).getUTCDay();
}

export const longDateWithYear = (iso: string) =>
  format(iso, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
