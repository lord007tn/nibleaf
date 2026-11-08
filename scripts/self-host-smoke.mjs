import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { assertUnusedProject } from './self-host-safety.mjs';

// Manual, isolated packaging smoke. No image builds, real credentials or paid
// providers. Refuse an existing project rather than disturbing someone else's run.
const project = 'nibleaf-selfhost';
assertUnusedProject(project);
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
const start = (...command) => {
  const child = spawn('docker', [...args, ...command], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (chunk) => {
      output += chunk;
    });
  const done = new Promise((resolve, reject) => {
    child.on('error', () => reject(new Error('Owned Docker process could not start')));
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('Owned Docker process failed'))));
  });
  // Attach immediately: teardown still awaits every child if a later step fails.
  done.catch(() => {
    // The owner awaits the original promise in teardown.
  });
  return { child, done, output: () => output };
};
const children = [];
const until = async (condition, message) => {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(message);
};
try {
  dc('config', '--quiet');
  dc('up', '-d', '--wait', 'postgres', 'dragonfly', 'clickhouse', 'maxio');
  // Complete Prisma's concurrent-index migration before holding a transaction
  // snapshot for the independent ClickHouse advisory-lock contention check.
  dc('run', '--rm', 'migrate');
  const lock = start(
    'exec',
    '-T',
    'postgres',
    'psql',
    '-U',
    'nibleaf',
    '-d',
    'nibleaf',
    '-c',
    "SET application_name='nibleaf-smoke-lock'; SELECT pg_advisory_lock(hashtextextended('nibleaf:clickhouse:migrations:nibleaf_analytics',904712)); SELECT pg_sleep(180);",
  );
  children.push(lock);
  await until(
    () =>
      dc(
        'exec',
        '-T',
        'postgres',
        'psql',
        '-U',
        'nibleaf',
        '-d',
        'nibleaf',
        '-Atc',
        "SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE a.application_name='nibleaf-smoke-lock' AND l.locktype='advisory' AND l.granted",
      ).trim() === '1',
    'Fixture migration lock was not acquired',
  );
  dc('up', '-d', '--no-deps', 'worker');
  const migrate = start('--profile', 'analytics-tools', 'run', '--rm', '--no-deps', 'analytics-migrate');
  children.push(migrate);
  await until(
    () =>
      dc('logs', 'worker').includes('ClickHouse migration lock held by another process') &&
      migrate.output().includes('ClickHouse migrations are running in another process'),
    'Worker and CLI did not both contend for the held migration lock',
  );
  dc(
    'exec',
    '-T',
    'postgres',
    'psql',
    '-U',
    'nibleaf',
    '-d',
    'nibleaf',
    '-Atc',
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name='nibleaf-smoke-lock'",
  );
  await lock.done.catch(() => {
    // Expected termination releases only our fixture lock.
  });
  await migrate.done;
  dc('up', '-d', '--wait', '--wait-timeout', '240');
  const health = await (await fetch('http://127.0.0.1:4452/health')).json();
  assert.equal(health.status, 'ok', JSON.stringify(health));
  assert.equal(health.analytics.status, 'ok', JSON.stringify(health));
  assert.equal((await fetch('http://127.0.0.1:4450/sign-in')).status, 200);
  console.log(
    JSON.stringify({
      project,
      image: 'v0.2.1',
      app: 200,
      worker: 'ok',
      analytics: 'ok',
      concurrentMigration: 'passed',
    }),
  );
} catch {
  // Docker errors include child environment and service logs can contain secrets.
  // Keep both out of console output, including the exception's attached fields.
  process.stderr.write('Self-host smoke failed; inspect the isolated fixture locally.\n');
  process.exitCode = 1;
} finally {
  try {
    dc('down', '--volumes');
  } catch {
    process.exitCode = 1;
  }
  for (const child of children) child.child.kill();
  await Promise.allSettled(children.map((child) => child.done));
  await rm(directory, { recursive: true, force: true });
}
