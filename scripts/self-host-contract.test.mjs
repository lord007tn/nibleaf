import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { assertManifestMatches, buildSelfHostRelease } from './self-host-release.mjs';

test('published v0.2.1 inputs remain checksum-identical while next-release templates evolve', async () => {
  const release = await buildSelfHostRelease();
  assertManifestMatches(release);
});

test('Docker builds can supply the fixed marketing star snapshot', async () => {
  const dockerfile = await readFile('Dockerfile', 'utf8');
  assert.match(dockerfile, /FROM base AS build\nARG MARKETING_GITHUB_STARS=0\nENV MARKETING_GITHUB_STARS=\$MARKETING_GITHUB_STARS/);
  const turbo = JSON.parse(await readFile('turbo.json', 'utf8'));
  assert.ok(turbo.tasks.build.env.includes('MARKETING_GITHUB_STARS'));
});

test('restore advice points to empty-target recovery and cannot revive the unsafe recipe', async () => {
  const script = await readFile('scripts/backup.sh', 'utf8');
  assert.doesNotMatch(script, /pg_restore[^\n]*(?:--clean|--if-exists)/);
  assert.match(script, /empty-database restore/);
  assert.match(script, /compatible application\n# revision/);
  assert.match(script, /Preserve the previous database/);
  assert.match(script, /Keep app, admin, server and worker stopped/);
  assert.match(script, /ps --all -q server/);
  assert.match(script, /ps --all -q maxio/);
  for (const lang of ['', 'ar/']) {
    const doc = await readFile(`docs/${lang}self-hosting/backups-upgrades.mdx`, 'utf8');
    assert.match(doc, /--exit-on-error/);
    assert.match(doc, /schemaname='public'/);
    assert.doesNotMatch(doc, /pg_restore[^\n]*--clean/);
    assert.match(doc, /RESTORE_STORAGE_VOLUME/);
    assert.doesNotMatch(doc, /find \/data -mindepth 1 -delete/);
  }
});

test('smoke refuses retained data and never prints Docker environment or service logs', async () => {
  const script = await readFile('scripts/self-host-smoke.mjs', 'utf8');
  assert.ok(script.indexOf('assertUnusedProject(project)') < script.indexOf('await mkdtemp'));
  assert.doesNotMatch(script, /console\.error|throw error|console\.log\(dc/);
  assert.match(script, /image: 'v0\.2\.1'/);
  const restore = await readFile('scripts/self-host-restore.test.mjs', 'utf8');
  assert.ok(restore.indexOf("assertUnusedProject('nibleaf-selfhost')") < restore.indexOf("dc('up'"));
});

test('next-release Compose forwards documented export/MCP values and includes bounded analytics', async () => {
  const example = await readFile('.env.production.example', 'utf8');
  const keys = [...example.matchAll(/^(EXPORT_\w+|MCP_WRITE_RATE_LIMIT_PER_MIN|MCP_PUBLISH_RATE_LIMIT_PER_HOUR)=/gm)].map((match) => match[1]);
  const env = {
    ...process.env,
    POSTGRES_PASSWORD: 'fixture',
    STORAGE_PUBLIC_ENDPOINT: 'https://storage.invalid',
    STORAGE_ACCESS_KEY_ID: 'fixture',
    STORAGE_SECRET_ACCESS_KEY: 'fixture',
    BETTER_AUTH_SECRET: 'fixture'.repeat(8),
    APP_URL: 'https://app.invalid',
    CLICKHOUSE_PASSWORD: 'fixture',
    ANALYTICS_MODE: 'clickhouse',
    INTERNAL_API_SECRET: 'fixture-internal',
    ANALYTICS_CONCURRENCY: '3',
    ANALYTICS_HASH_SALT: 'fixture-salt',
    CLICKHOUSE_URL: 'http://fixture-clickhouse:8123',
    CLICKHOUSE_DATABASE: 'fixture_analytics',
    CLICKHOUSE_READER_USERNAME: 'fixture_reader',
    CLICKHOUSE_READER_PASSWORD: 'fixture-reader',
    CLICKHOUSE_WRITER_USERNAME: 'fixture_writer',
    CLICKHOUSE_WRITER_PASSWORD: 'fixture-writer',
    CLICKHOUSE_REQUEST_TIMEOUT_MS: '2001',
    CLICKHOUSE_MAX_BATCH_SIZE: '17',
    CLICKHOUSE_MAX_BUFFERED_EVENTS: '1234',
    CLICKHOUSE_FLUSH_INTERVAL_MS: '501',
    CLICKHOUSE_RAW_RETENTION_DAYS: '32',
    CLICKHOUSE_ROLLUP_RETENTION_DAYS: '33',
    CLICKHOUSE_SENSITIVE_RETENTION_DAYS: '34',
    CLICKHOUSE_CRAWLER_RETENTION_DAYS: '41',
    CLICKHOUSE_MIGRATE_ON_BOOT: 'false',
    ...Object.fromEntries(keys.map((key) => [key, key === 'EXPORT_CHROMIUM_PATH' ? '/fixture/chromium' : '1'])),
  };
  const config = JSON.parse(
    execFileSync(
      'docker',
      [
        'compose',
        '-p',
        'nibleaf-selfhost',
        '-f',
        'docker-compose.prod.yml',
        '--profile',
        'admin',
        '--profile',
        'analytics-tools',
        'config',
        '--format',
        'json',
      ],
      { env, encoding: 'utf8' },
    ),
  );
  for (const service of ['server', 'worker', 'app', 'admin', 'analytics-migrate']) {
    const actual = config.services[service].environment;
    for (const key of keys) assert.equal(actual[key], env[key], `${service}.${key}`);
    const analyticsKeys = [...example.matchAll(/^((?:ANALYTICS|CLICKHOUSE)_\w+)=/gm)]
      .map((match) => match[1])
      .filter((key) => key !== 'CLICKHOUSE_PASSWORD');
    for (const key of ['INTERNAL_API_SECRET', ...analyticsKeys]) {
      assert.equal(actual[key], env[key], `${service}.${key}`);
    }
  }
  const clickhouse = config.services.clickhouse;
  assert.deepEqual(clickhouse.profiles, ['analytics', 'analytics-tools']);
  assert.equal(clickhouse.mem_limit, '1610612736');
  assert.equal(clickhouse.cpus, 2);
  assert.equal(clickhouse.ports, undefined);
  assert.equal(clickhouse.environment.CLICKHOUSE_USER, 'fixture_writer');
  assert.equal(clickhouse.environment.CLICKHOUSE_PASSWORD, 'fixture-writer');
  assert.ok(clickhouse.healthcheck);
  assert.equal(clickhouse.volumes.length, 3);
  assert.ok(config.configs['clickhouse-small-host'].content.includes('<allowed_disk>backups</allowed_disk>'));
  assert.ok(config.services['analytics-migrate'].depends_on.postgres);
  assert.ok(config.services['analytics-migrate'].depends_on.clickhouse);
  const disabled = JSON.parse(
    execFileSync('docker', ['compose', '-p', 'nibleaf-selfhost', '-f', 'docker-compose.prod.yml', 'config', '--format', 'json'], {
      env: { ...env, COMPOSE_PROFILES: '', ANALYTICS_MODE: 'disabled', CLICKHOUSE_PASSWORD: '', CLICKHOUSE_WRITER_PASSWORD: '' },
      encoding: 'utf8',
    }),
  );
  assert.equal(disabled.services.clickhouse, undefined);
});

test('operator proxy guidance counts private hops and links to the troubleshooting table', async () => {
  for (const path of ['.env.example', '.env.production.example', 'docker-compose.prod.yml', 'docker-compose.coolify.yml']) {
    const source = await readFile(path, 'utf8');
    assert.match(source, /Count every address after the client in X-Forwarded-For, private ones included/);
    assert.match(source, /troubleshooting#readers-see-too-many-requests/);
    assert.doesNotMatch(source, /Private (?:proxy )?hops are skipped automatically/);
  }
});
