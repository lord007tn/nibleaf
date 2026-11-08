import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Manual, isolated packaging smoke. No image builds, real credentials or paid
// providers. Refuse an existing project rather than disturbing someone else's run.
const project = 'nibleaf-selfhost';
const existing = execFileSync('docker', ['ps', '-aq', '--filter', `label=com.docker.compose.project=${project}`], { encoding: 'utf8' }).trim();
assert.equal(existing, '', 'Refusing to reuse an existing nibleaf-selfhost project');
const directory = await mkdtemp(join(tmpdir(), 'nibleaf-selfhost-smoke-'));
const example = await readFile('.env.production.example', 'utf8');
const env = { ...process.env, ...Object.fromEntries([...example.matchAll(/^(\w+)=/gm)].map((match) => [match[1], ''])) };
Object.assign(env, {
  COMPOSE_PROFILES: 'analytics',
  POSTGRES_PASSWORD: 'fixture-postgres',
  CLICKHOUSE_PASSWORD: 'fixture-clickhouse',
  ANALYTICS_HASH_SALT: 'fixture-hash-salt-0123456789abcdef',
  ANALYTICS_MODE: 'clickhouse',
  APP_URL: 'http://127.0.0.1:4450',
  APP_PORT: '4450',
  NIBLEAF_BIND: '127.0.0.1',
  STORAGE_ACCESS_KEY_ID: 'fixture',
  STORAGE_SECRET_ACCESS_KEY: 'fixture-storage-secret',
  STORAGE_PUBLIC_ENDPOINT: 'http://127.0.0.1:9360',
  STORAGE_PUBLIC_URL: 'http://127.0.0.1:9360/nibleaf',
  BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
  INTERNAL_API_SECRET: randomBytes(32).toString('hex'),
  EMAIL_DELIVERY_REQUIRED: 'false',
  WORKBENCH_USER: 'fixture',
  WORKBENCH_PASS: 'fixture-workbench',
  NIBLEAF_VERSION: 'v0.2.1',
  INTEGRATION_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
});
const override = join(directory, 'ports.yml');
await writeFile(
  override,
  `services:
  server:
    ports: ["127.0.0.1:4451:4311"]
  worker:
    ports: ["127.0.0.1:4452:4312"]
  maxio:
    ports: ["127.0.0.1:9360:9000"]
`,
);
const args = ['compose', '-p', project, '--env-file', join(directory, 'empty.env'), '-f', resolve('docker-compose.prod.yml'), '-f', override];
await writeFile(join(directory, 'empty.env'), '');
const dc = (...command) =>
  execFileSync('docker', [...args, ...command], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 300_000 });
try {
  dc('config', '--quiet');
  dc('up', '-d', '--wait', '--wait-timeout', '240');
  const health = await (await fetch('http://127.0.0.1:4452/health')).json();
  assert.equal(health.status, 'ok', JSON.stringify(health));
  assert.equal(health.analytics.status, 'ok', JSON.stringify(health));
  assert.equal((await fetch('http://127.0.0.1:4450/sign-in')).status, 200);
  // Exercises the real advisory-lock migration path while the worker is running.
  dc('--profile', 'analytics-tools', 'run', '--rm', 'analytics-migrate');
  console.log(
    JSON.stringify({
      project,
      image: env.NIBLEAF_VERSION,
      app: 200,
      worker: health.status,
      analytics: health.analytics.status,
      concurrentMigration: 'passed',
    }),
  );
} catch (error) {
  console.error(dc('ps', '--all'));
  console.error(dc('logs', '--tail', '50', 'server', 'worker', 'clickhouse', 'migrate'));
  throw error;
} finally {
  dc('down', '--volumes');
  await rm(directory, { recursive: true, force: true });
}
