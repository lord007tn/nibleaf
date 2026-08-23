import { createClient } from '@clickhouse/client';
import { keys } from '../src/keys';
import { runClickHouseMigrations } from '../src/migrations';

const config = keys();
const admin = createClient({
  url: config.CLICKHOUSE_URL,
  username: config.CLICKHOUSE_WRITER_USERNAME,
  password: config.CLICKHOUSE_WRITER_PASSWORD,
  request_timeout: config.CLICKHOUSE_REQUEST_TIMEOUT_MS,
});
try {
  await admin.command({ query: `CREATE DATABASE IF NOT EXISTS ${config.CLICKHOUSE_DATABASE}` });
} finally {
  await admin.close();
}

const client = createClient({
  url: config.CLICKHOUSE_URL,
  database: config.CLICKHOUSE_DATABASE,
  username: config.CLICKHOUSE_WRITER_USERNAME,
  password: config.CLICKHOUSE_WRITER_PASSWORD,
  request_timeout: config.CLICKHOUSE_REQUEST_TIMEOUT_MS,
});
try {
  const applied = await runClickHouseMigrations(client, {
    rawRetentionDays: config.CLICKHOUSE_RAW_RETENTION_DAYS,
    rollupRetentionDays: config.CLICKHOUSE_ROLLUP_RETENTION_DAYS,
    sensitiveRetentionDays: config.CLICKHOUSE_SENSITIVE_RETENTION_DAYS,
  });
  process.stdout.write(`[nibleaf] ClickHouse analytics migrations complete (${applied.length ? applied.join(', ') : 'already current'}).\n`);
} finally {
  await client.close();
}
