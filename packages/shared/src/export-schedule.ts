export type ExportCadence = 'DAILY' | 'WEEKLY' | 'MONTHLY';

export interface ExportScheduleTiming {
  cadence: ExportCadence;
  timezone: string;
  hour: number;
  minute: number;
  weekday?: number | null;
  monthday?: number | null;
}

/** Stable database idempotency key for one schedule wall-clock slot. */
export const exportScheduleSlotKey = (scheduleId: string, slot: Date): string => `schedule:${scheduleId}:${slot.toISOString()}`;

interface DateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

const formatter = (timezone: string): Intl.DateTimeFormat => {
  const cached = formatterCache.get(timezone);
  if (cached) return cached;
  const value = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  formatterCache.set(timezone, value);
  return value;
};

const partsAt = (date: Date, timezone: string): DateParts => {
  const values = Object.fromEntries(
    formatter(timezone)
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
};

const sameWallMinute = (a: DateParts, b: Omit<DateParts, 'second'>): boolean =>
  a.year === b.year && a.month === b.month && a.day === b.day && a.hour === b.hour && a.minute === b.minute;

const offsetAt = (instant: number, timezone: string): number => {
  const p = partsAt(new Date(instant), timezone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(instant / 1000) * 1000;
};

/** Resolve a local wall-clock minute. Sampling adjacent offsets handles DST
 * folds without depending on a host timezone database API beyond Intl. A DST
 * gap intentionally has no candidate, matching cron's skip semantics. */
const wallTimeCandidates = (wall: Omit<DateParts, 'second'>, timezone: string): Date[] => {
  const naive = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  const offsets = new Set([offsetAt(naive - 86_400_000, timezone), offsetAt(naive, timezone), offsetAt(naive + 86_400_000, timezone)]);
  return [...offsets]
    .map((offset) => new Date(naive - offset))
    .filter((candidate) => sameWallMinute(partsAt(candidate, timezone), wall))
    .sort((a, b) => a.getTime() - b.getTime());
};

const daysInMonth = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate();

const matchesDate = (date: Date, timing: ExportScheduleTiming): boolean => {
  if (timing.cadence === 'DAILY') return true;
  if (timing.cadence === 'WEEKLY') return date.getUTCDay() === timing.weekday;
  const last = daysInMonth(date.getUTCFullYear(), date.getUTCMonth() + 1);
  return date.getUTCDate() === Math.min(timing.monthday ?? 1, last);
};

/** Return the first scheduled instant strictly after `after`. This operates on
 * local calendar dates, so daily/weekly/monthly archives keep their requested
 * wall-clock time across timezone and daylight-saving transitions. */
export const nextExportRunAt = (timing: ExportScheduleTiming, after: Date): Date => {
  // Throws RangeError for an invalid IANA timezone even if called outside API validation.
  const local = partsAt(after, timing.timezone);
  const start = new Date(Date.UTC(local.year, local.month - 1, local.day));
  for (let offset = 0; offset <= 370; offset += 1) {
    const date = new Date(start.getTime() + offset * 86_400_000);
    if (!matchesDate(date, timing)) continue;
    // A DST fold can contain the same local minute twice. Once a schedule has
    // run in that wall-clock minute, advance to the next calendar occurrence
    // instead of archiving twice with different UTC instants.
    if (offset === 0 && local.hour === timing.hour && local.minute === timing.minute) continue;
    const wall = {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: timing.hour,
      minute: timing.minute,
    };
    const candidate = wallTimeCandidates(wall, timing.timezone).find((value) => value.getTime() > after.getTime());
    if (candidate) return candidate;
  }
  throw new Error('Could not determine the next export run within 370 days.');
};
