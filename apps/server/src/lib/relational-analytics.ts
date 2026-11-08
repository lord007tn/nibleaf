import { Prisma, prisma } from '@nibleaf/database';
import type { AnalyticsRange } from '@nibleaf/validators';

const RANGE_DAYS: Record<AnalyticsRange, number> = { '24h': 1, '7d': 7, '30d': 30, '90d': 90 };

export const relationalInterval = (range: AnalyticsRange, requestedTimezone: string, now = new Date()) => {
  let timezone = requestedTimezone;
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone }).format(now);
  } catch {
    timezone = 'UTC';
  }
  const since = new Date(now.getTime() - RANGE_DAYS[range] * 86_400_000);
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const dateAt = (instant: Date) => {
    const parts = Object.fromEntries(formatter.formatToParts(instant).map(({ type, value }) => [type, value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  };
  const dates: string[] = [];
  const last = dateAt(now);
  for (let day = new Date(`${dateAt(since)}T00:00:00Z`); day.toISOString().slice(0, 10) <= last; day = new Date(day.getTime() + 86_400_000)) {
    dates.push(day.toISOString().slice(0, 10));
  }
  return { since, until: now, timezone, dates };
};

/** One PostgreSQL snapshot returns a total row and at most 92 local-day rows (DST edges included). */
export const relationalViewSummary = async (projectIds: string[], interval: ReturnType<typeof relationalInterval>) => {
  const rows = await prisma.$queryRaw<Array<{ date: string | null; views: bigint; visitors: bigint }>>(Prisma.sql`
    WITH events AS (
      SELECT to_char("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${interval.timezone}, 'YYYY-MM-DD') AS date, "sessionId"
      FROM analytics_event WHERE "projectId" IN (${Prisma.join(projectIds)}) AND type = 'pageview'
        AND "createdAt" >= ${interval.since} AND "createdAt" < ${interval.until}
    )
    SELECT date, count(*) AS views, count(DISTINCT "sessionId") AS visitors
    FROM events GROUP BY GROUPING SETS ((date), ())`);
  const totals = rows.find((row) => row.date === null);
  const counts = new Map(rows.map((row) => [row.date, Number(row.views)]));
  return {
    totalViews: Number(totals?.views ?? 0),
    uniqueVisitors: Number(totals?.visitors ?? 0),
    timeseries: interval.dates.map((date) => ({ date, views: counts.get(date) ?? 0 })),
  };
};
