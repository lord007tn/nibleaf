import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Redis from 'ioredis';

const endpoint = process.env.SCHEDULE_TEST_REDIS_URL;
if (!endpoint) throw new Error('Set SCHEDULE_TEST_REDIS_URL to an isolated disposable Redis/Dragonfly endpoint');
const url = new URL(endpoint);
if (url.protocol !== 'redis:') throw new Error('The isolated dry-run verifier expects redis://');
const client = new Redis(endpoint, { maxRetriesPerRequest: 1, retryStrategy: () => null });
client.on('error', () => undefined);
const fixtureKey = `nibleaf-dry-run-test-${randomUUID()}`;

async function snapshot() {
  const keys: string[] = [];
  let cursor = '0';
  do {
    const page = await client.scan(cursor, 'COUNT', 100);
    cursor = page[0];
    keys.push(...page[1]);
  } while (cursor !== '0');
  const entries = new Map<string, { value: Buffer | null; ttl: number; at: number }>();
  for (const key of keys.sort()) entries.set(key, { value: await client.dumpBuffer(key), ttl: await client.pttl(key), at: Date.now() });
  return entries;
}

try {
  await client.set(fixtureKey, 'synthetic-expiring-value', 'PX', 600_000);
  const before = await snapshot();
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(new URL('../../../node_modules/tsx/dist/cli.mjs', import.meta.url)),
        fileURLToPath(new URL('./migrate-schedules.ts', import.meta.url)),
      ],
      {
        env: {
          ...process.env,
          REDIS_HOST: url.hostname,
          REDIS_PORT: url.port || '6379',
          REDIS_DB: url.pathname.slice(1) || '0',
          REDIS_PASSWORD: decodeURIComponent(url.password),
        },
        // No job data, connection errors, or Redis values are emitted.
        stdio: 'ignore',
      },
    );
    child.once('error', reject);
    child.once('exit', resolve);
  });
  assert.equal(exitCode, 0, 'Default operator dry-run must succeed');
  const after = await snapshot();
  assert.deepEqual([...after.keys()], [...before.keys()], 'Dry-run changed the Redis key set');
  for (const [key, previous] of before) {
    const current = after.get(key);
    assert.ok(current);
    assert.deepEqual(current.value, previous.value, 'Dry-run changed a Redis value');
    if (previous.ttl < 0) assert.equal(current.ttl, previous.ttl, 'Dry-run changed expiry policy');
    else assert.ok(Math.abs(current.ttl - (previous.ttl - (current.at - previous.at))) < 1500, 'Dry-run changed TTL beyond elapsed time');
  }
  console.log('PASS: default operator dry-run preserved all Redis keys, serialized values, and TTLs accounting for elapsed time');
} finally {
  await client.del(fixtureKey);
  await client.quit();
}
