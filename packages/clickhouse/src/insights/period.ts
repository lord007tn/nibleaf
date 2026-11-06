import type { InsightsMeta } from './types';

export interface InsightsQuery {
  range: '24h' | '7d' | '30d' | '90d' | 'custom';
  from?: string;
  to?: string;
  timezone: string;
  compare: 'previous' | 'none';
}

const dayMs = 86_400_000;
const localParts = (date: Date, timezone: string) =>
  Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );

/** Resolve local midnight without assuming a fixed UTC offset. Iteration also
 * handles half-hour offsets and DST changes between the two endpoints. */
export const localMidnight = (day: string, timezone: string): number => {
  const wallTime = Date.parse(`${day}T00:00:00Z`);
  let instant = wallTime;
  for (let index = 0; index < 5; index += 1) {
    const p = localParts(new Date(instant), timezone);
    const represented = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
    const next = instant + wallTime - represented;
    if (next === instant) break;
    instant = next;
  }
  return instant;
};

export const resolveInsightsMeta = (query: InsightsQuery, now = new Date()): InsightsMeta => {
  let timezone = query.timezone;
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone }).format(now);
  } catch {
    timezone = 'UTC';
  }
  const to =
    query.range === 'custom' && query.to ? localMidnight(new Date(Date.parse(query.to) + dayMs).toISOString().slice(0, 10), timezone) : now.getTime();
  const from =
    query.range === 'custom' && query.from
      ? localMidnight(query.from, timezone)
      : to - (query.range === '24h' ? 1 : Number.parseInt(query.range === 'custom' ? '30' : query.range, 10)) * dayMs;
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) throw new Error('Invalid insights period');
  const calendarDays = query.range === 'custom' && query.from && query.to ? (Date.parse(query.to) - Date.parse(query.from)) / dayMs + 1 : null;
  const previousFrom =
    calendarDays !== null && query.from
      ? localMidnight(new Date(Date.parse(query.from) - calendarDays * dayMs).toISOString().slice(0, 10), timezone)
      : from - (to - from);
  return {
    availability: 'complete',
    lastEventAt: null,
    timezone,
    current: { from: new Date(from).toISOString(), to: new Date(to).toISOString() },
    previous: query.compare === 'previous' ? { from: new Date(previousFrom).toISOString(), to: new Date(from).toISOString() } : null,
    granularity: query.range === '24h' ? 'hour' : 'day',
    generatedAt: now.toISOString(),
  };
};
