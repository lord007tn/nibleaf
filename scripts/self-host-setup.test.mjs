import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const runtimeScript = fileURLToPath(new URL('./configure-web-runtime.mjs', import.meta.url));
const read = (path) => readFileSync(join(root, path), 'utf8');

test('Docker web output resolves installation URLs on boot and restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'nibleaf-web-runtime-'));
  try {
    mkdirSync(join(directory, 'public'));
    mkdirSync(join(directory, 'server'));
    const path = join(directory, 'public', 'client.js');
    writeFileSync(
      path,
      'export const config = ["https://nibleaf-runtime-app.invalid", "http://nibleaf-runtime-api.invalid/api/**", "nibleaf-runtime-site.invalid"];',
    );
    writeFileSync(`${path}.br`, 'stale compressed output');
    const entry = join(directory, 'server', 'index.mjs');
    writeFileSync(
      entry,
      `var public_assets_data_default = ${JSON.stringify(
        {
          '/client.js': { path: '../public/client.js', size: 999, etag: 'stale' },
          '/client.js.br': { path: '../public/client.js.br', size: 99, etag: 'stale', encoding: 'br' },
        },
        null,
        2,
      )};\nconst cacheControl = "public, max-age=31536000, immutable";`,
    );
    for (const host of ['docs.acme.test', 'nibleaf.com']) {
      const result = spawnSync(process.execPath, [runtimeScript, directory], {
        encoding: 'utf8',
        env: { ...process.env, APP_URL: `https://${host}`, API_URL: 'http://private-api:4311', SITE_BASE_DOMAIN: `sites.${host}` },
      });
      assert.equal(result.status, 0, result.stderr);
      assert.match(readFileSync(path, 'utf8'), new RegExp(`https://${host.replaceAll('.', '\\.')}`));
      const config = JSON.parse(readFileSync(path, 'utf8').match(/\[.*\]/)[0]);
      assert.deepEqual(config, [`https://${host}`, 'http://private-api:4311/api/**', `sites.${host}`]);
      const server = readFileSync(entry, 'utf8');
      const manifest = JSON.parse(server.match(/var public_assets_data_default = (.*);/)[1]);
      assert.equal(manifest['/client.js'].size, Buffer.byteLength(readFileSync(path, 'utf8')));
      assert.notEqual(manifest['/client.js'].etag, 'stale');
      assert.equal(manifest['/client.js.br'], undefined);
      assert.match(server, /public, max-age=0, must-revalidate/);
    }
    assert.throws(() => readFileSync(`${path}.br`), { code: 'ENOENT' });
    const invalid = spawnSync(process.execPath, [runtimeScript, directory], {
      env: { ...process.env, APP_URL: "https://bad'host.test", SITE_BASE_DOMAIN: 'sites.example.test' },
      encoding: 'utf8',
    });
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /must be an HTTP/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('shared image and manual Docker CI do not bake cloud URL build arguments', () => {
  const dockerfile = read('Dockerfile');
  assert.match(dockerfile, /ENV VITE_APP_URL=https:\/\/nibleaf-runtime-app\.invalid/);
  assert.doesNotMatch(dockerfile, /ARG VITE_(APP_URL|API_URL|SITE_BASE_DOMAIN)/);
  const workflow = read('.github/workflows/docker.yml');
  assert.doesNotMatch(workflow, /VITE_(APP_URL|API_URL|SITE_BASE_DOMAIN)=/);
  assert.doesNotMatch(workflow, /pull_request\s*:/);
  assert.match(read('docker-entrypoint.sh'), /export VITE_APP_URL="\$\{APP_URL:/);
});

test('source and Coolify explicitly forward signup, SMTP and Git controls', () => {
  for (const file of ['docker-compose.yml', 'docker-compose.coolify.yml']) {
    const compose = read(file);
    for (const key of ['DISABLE_SIGNUP', 'SMTP_URL', 'GIT_CREDENTIAL_ENCRYPTION_KEY', 'GIT_WORKER_SECRET', 'GIT_CONCURRENCY']) {
      assert.ok(compose.includes(`${key}: \${${key}:-`), `${file} must forward ${key}`);
    }
  }
  const source = read('docker-compose.yml');
  assert.match(source, /CUSTOM_DOMAIN_CNAME_TARGET: \$\{CUSTOM_DOMAIN_CNAME_TARGET:-\}/);
  for (const key of ['MAXIO_DEFAULT_BUCKETS', 'MAXIO_PUBLIC_BUCKETS']) assert.ok(source.includes(`${key}: \${STORAGE_BUCKET:-nibleaf}`));
  assert.match(source.split('\n  app:')[1], /stop_grace_period: \$\{NIBLEAF_SHUTDOWN_GRACE:-45s\}/);
});

test('development mail capture and every datastore publish on loopback only', () => {
  const compose = read('docker-compose.dev.yml');
  const ports = [...compose.matchAll(/^\s+- '([^']+:\d+)'$/gm)].map((match) => match[1]);
  assert.equal(ports.length, 7);
  for (const port of ports) assert.ok(port.startsWith('127.0.0.1:'), port);
  assert.ok(ports.includes('127.0.0.1:1025:1025'));
  assert.ok(ports.includes('127.0.0.1:8025:8025'));
  assert.match(read('.env.example'), /^SMTP_URL=smtp:\/\/127\.0\.0\.1:1025$/m);
  const readme = read('README.md');
  assert.ok(readme.indexOf('\npnpm db:generate') < readme.indexOf('\npnpm db:seed'));
});

test('documented dev launcher loads root env for every frontend task', () => {
  const directory = mkdtempSync(join(tmpdir(), 'nibleaf-dev-env-'));
  try {
    mkdirSync(join(directory, 'scripts'));
    mkdirSync(join(directory, 'node_modules', 'turbo', 'bin'), { recursive: true });
    writeFileSync(join(directory, 'scripts', 'dev.mjs'), readFileSync(new URL('./dev.mjs', import.meta.url), 'utf8'));
    writeFileSync(join(directory, '.env'), 'VITE_APP_URL=https://local-custom.example.test\nVITE_API_URL=http://local-api:9001\n');
    writeFileSync(
      join(directory, 'node_modules', 'turbo', 'bin', 'turbo'),
      'console.log(JSON.stringify({ app:process.env.VITE_APP_URL, api:process.env.VITE_API_URL, args:process.argv.slice(2) }));',
    );
    for (const mode of ['app', 'full']) {
      const env = { ...process.env };
      delete env.VITE_APP_URL;
      delete env.VITE_API_URL;
      const result = spawnSync(process.execPath, [join(directory, 'scripts', 'dev.mjs'), mode], { env, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      const output = JSON.parse(result.stdout);
      assert.equal(output.app, 'https://local-custom.example.test');
      assert.equal(output.api, 'http://local-api:9001');
      assert.deepEqual(output.args.slice(0, 2), ['watch', 'dev']);
      assert.equal(output.args.includes('@nibleaf/app'), mode === 'app');
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
