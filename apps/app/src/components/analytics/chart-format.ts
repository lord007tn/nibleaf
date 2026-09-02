const CALENDAR_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parse a timeseries bucket for display. Daily buckets arrive as "YYYY-MM-DD"
 * already converted to the viewer's timezone, so they must be read as a local
 * calendar day: `new Date('2026-08-26')` is UTC midnight, which every locale
 * formatter west of UTC would render as the previous day. Anything else (a full
 * timestamp) is passed through to the Date constructor.
 */
export function parseSeriesDate(value: string): Date {
  const match = CALENDAR_DAY.exec(value);
  if (!match) return new Date(value);
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}
