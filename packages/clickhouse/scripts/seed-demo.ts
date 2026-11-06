import { parseArgs } from 'node:util';
import { closeClickHouseClients, insertAnalyticsEvents } from '../src/client';
import { demoAnalyticsEvents } from './demo-data';

if (process.env.NODE_ENV === 'production') throw new Error('Demo seeding is disabled in production.');
const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: { tenant: { type: 'string' }, project: { type: 'string' }, days: { type: 'string', default: '60' } },
});
const days = Number(values.days);
if (!values.tenant || !values.project || !Number.isInteger(days) || days < 1 || days > 366)
  throw new Error('Use --tenant <orgId> --project <projectId> --days <1..366>');
try {
  const events = demoAnalyticsEvents(values.tenant, values.project, days);
  for (let offset = 0; offset < events.length; offset += 500) await insertAnalyticsEvents(events.slice(offset, offset + 500));
  process.stdout.write(`Inserted ${events.length} fictional analytics events across ${days} days.\n`);
} finally {
  await closeClickHouseClients();
}
