import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';

const root = fileURLToPath(new URL('../', import.meta.url));
const runtimeScript = fileURLToPath(new URL('./configure-web-runtime.mjs', import.meta.url));
const read = (path) => readFileSync(join(root, path), 'utf8');

function runtimeFixture(service) {
  const directory = mkdtempSync(join(tmpdir(), `nibleaf-${service}-runtime-`));
  const output = join(directory, service, '.output');
  mkdirSync(join(output, 'public', 'assets'), { recursive: true });
  mkdirSync(join(output, 'server', '_ssr'), { recursive: true });
  const client = join(output, 'public', 'assets', 'client.js');
  writeFileSync(
    client,
    'export const config = ["https://nibleaf-runtime-app.invalid", "https://nibleaf-runtime-admin.invalid", "http://nibleaf-runtime-api.invalid/api/**", "nibleaf-runtime-site.invalid"];',
  );
  writeFileSync(`${client}.br`, 'stale compressed bytes');
  writeFileSync(join(output, 'public', 'assets', 'vendor.js'), 'export const unchanged = true;');
  writeFileSync(join(output, 'server', '_ssr', 'ssr.mjs'), 'const app = "https://nibleaf-runtime-app.invalid";');
  writeFileSync(join(output, '.nibleaf-runtime-required'), '');
  const assets = {
    '/assets/client.js': { path: '../public/assets/client.js', size: 999, etag: 'stale' },
    '/assets/client.js.br': { path: '../public/assets/client.js.br', size: 99, etag: 'stale', encoding: 'br' },
    '/assets/vendor.js': { path: '../public/assets/vendor.js', size: 30, etag: 'vendor-etag' },
  };
  const entry = join(output, 'server', 'index.mjs');
  writeFileSync(
    entry,
    `var public_assets_data_default = ${JSON.stringify(assets, null, '\t')};
var globalHeaders = { "cache-control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" };
function findRouteRules() { return [{ data: { route: "/assets/**", rank: 1, rules: [
  { name: "headers", options: globalHeaders }, { name: "other", options: { retained: true } }
] } }]; }
var routeMatcher = createMatcherFromFind(findRouteRules);
`,
  );
  // Nitro's actual output uses tabs, not the two-space synthetic shape.
  assert.match(readFileSync(entry, 'utf8'), /\n\t"\/assets\/client\.js"/);
  return { directory, output, client, entry };
}

function configureRuntime(output, env = {}, preload = null) {
  return spawnSync(process.execPath, [...(preload ? ['--import', pathToFileURL(preload).href] : []), runtimeScript, output], {
    encoding: 'utf8',
    env: {
      ...process.env,
      APP_URL: 'https://docs.acme.test',
      ADMIN_URL: 'https://admin.acme.test',
      API_URL: 'http://private-api:4311',
      SITE_BASE_DOMAIN: 'sites.acme.test',
      ...env,
    },
  });
}

for (const service of ['app', 'admin']) {
  test(`${service} runtime rewrites only configured assets and retains global immutable caching`, () => {
    const fixture = runtimeFixture(service);
    try {
      for (const host of ['docs.acme.test', 'nibleaf.com']) {
        const result = configureRuntime(fixture.output, {
          APP_URL: `https://${host}`,
          ADMIN_URL: `https://admin.${host}`,
          SITE_BASE_DOMAIN: `*.sites.${host}.`,
          API_URL: '',
        });
        assert.equal(result.status, 0, result.stderr);
        const configured = readFileSync(fixture.client, 'utf8');
        assert.deepEqual(JSON.parse(configured.match(/\[.*\]/)[0]), [
          `https://${host}`,
          `https://admin.${host}`,
          'http://server:4311/api/**',
          `sites.${host}`,
        ]);
        assert.ok(readFileSync(join(fixture.output, 'server', '_ssr', 'ssr.mjs'), 'utf8').includes(`https://${host}`));
        const context = {};
        runInNewContext(readFileSync(fixture.entry, 'utf8'), {
          ...context,
          createMatcherFromFind: (matcher) => {
            context.matcher = matcher;
          },
        });
        const changed = context.matcher('GET', '/assets/client.js')[0].data.rules;
        const unchanged = context.matcher('GET', '/assets/vendor.js')[0].data.rules;
        assert.equal(changed[0].options['cache-control'], 'public, max-age=0, must-revalidate');
        assert.equal(changed[0].options['X-Content-Type-Options'], 'nosniff');
        assert.equal(changed[1].options.retained, true);
        assert.equal(unchanged[0].options['cache-control'], 'public, max-age=31536000, immutable');
        const metadata = JSON.parse(readFileSync(fixture.entry, 'utf8').match(/var public_assets_data_default = (.*);/)[1]);
        assert.equal(metadata['/assets/client.js'].size, Buffer.byteLength(configured));
        assert.notEqual(metadata['/assets/client.js'].etag, 'stale');
        assert.equal(metadata['/assets/client.js.br'], undefined);
        assert.equal(metadata['/assets/vendor.js'].etag, 'vendor-etag');
        assert.ok(existsSync(join(fixture.output, '.nibleaf-runtime-configured')));
      }
      assert.equal(existsSync(`${fixture.client}.br`), false);
      assert.equal(existsSync(join(fixture.output, 'public', 'assets', 'vendor.js.nibleaf-runtime-template')), false);
      const invalid = configureRuntime(fixture.output, { APP_URL: "https://bad'host.test" });
      assert.notEqual(invalid.status, 0);
      assert.match(invalid.stderr, /must be an HTTP/);
    } finally {
      rmSync(fixture.directory, { recursive: true, force: true });
    }
  });
}

for (const [operation, code] of [
  ['writeFile', 'EROFS'],
  ['rename', 'EACCES'],
]) {
  test(`runtime configuration fails clearly and atomically on ${code}`, () => {
    const fixture = runtimeFixture('readonly');
    try {
      const original = readFileSync(fixture.client, 'utf8');
      writeFileSync(join(fixture.output, '.nibleaf-runtime-configured'), 'previous configuration');
      const preload = join(fixture.directory, 'deny.mjs');
      writeFileSync(
        preload,
        `import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
const original = fs.${operation};
fs.${operation} = async (...args) => {
  if ('${operation}' === 'writeFile' || String(args[1]).endsWith('client.js')) {
    throw Object.assign(new Error('synthetic permission failure'), { code: '${code}' });
  }
  return original(...args);
};
syncBuiltinESMExports();`,
      );
      const result = configureRuntime(fixture.output, {}, preload);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, new RegExp(`not writable \\(${code}\\)`));
      assert.match(result.stderr, /Allow the service UID/);
      assert.equal(readFileSync(fixture.client, 'utf8'), original);
      assert.equal(existsSync(`${fixture.client}.nibleaf-runtime-template`), operation === 'rename');
      if (operation === 'rename') assert.equal(readFileSync(`${fixture.client}.nibleaf-runtime-template`, 'utf8'), original);
      assert.equal(existsSync(join(fixture.output, '.nibleaf-runtime-configured')), false);
      assert.equal(
        readdirSync(join(fixture.output, 'public', 'assets')).some((name) => name.endsWith('.tmp')),
        false,
      );
    } finally {
      rmSync(fixture.directory, { recursive: true, force: true });
    }
  });
}

test('web wrapper refuses an unconfigured image or unresolved server markers', () => {
  const fixture = runtimeFixture('guard');
  try {
    const wrapper = fileURLToPath(new URL('./graceful-web-service.mjs', import.meta.url));
    const required = spawnSync(process.execPath, [wrapper, fixture.entry], { encoding: 'utf8' });
    assert.notEqual(required.status, 0);
    assert.match(required.stderr, /Web runtime configuration is incomplete/);
    rmSync(join(fixture.output, '.nibleaf-runtime-required'));
    writeFileSync(fixture.entry, 'const origin = "https://nibleaf-runtime-app.invalid";');
    const markers = spawnSync(process.execPath, [wrapper, fixture.entry], { encoding: 'utf8' });
    assert.notEqual(markers.status, 0);
    assert.match(markers.stderr, /configure-web-runtime\.mjs/);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
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
    for (const key of ['DISABLE_SIGNUP', 'GIT_CREDENTIAL_ENCRYPTION_KEY', 'GIT_WORKER_SECRET', 'GIT_CONCURRENCY', 'STORAGE_REQUIRED_FOR_HEALTH']) {
      assert.ok(compose.includes(`${key}: \${${key}:-`), `${file} must forward ${key}`);
    }
  }
  assert.match(read('docker-compose.coolify.yml'), /SMTP_URL: \$\{SMTP_URL:-\}/);
  const source = read('docker-compose.yml');
  assert.match(source, /SMTP_URL: \$\{SOURCE_SMTP_URL:-smtp:\/\/mailpit:1025\}/);
  assert.match(source, /\n {2}mailpit:\n/);
  assert.doesNotMatch(source, /SMTP_URL: \$\{SMTP_URL/);
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

for (const signal of ['SIGINT', 'SIGTERM']) {
  test(`development launcher forwards ${signal} and uses the child's final exit status`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'nibleaf-dev-signals-'));
    try {
      mkdirSync(join(directory, 'scripts'));
      writeFileSync(join(directory, 'scripts', 'dev.mjs'), readFileSync(new URL('./dev.mjs', import.meta.url), 'utf8'));
      writeFileSync(join(directory, '.env'), 'SYNTHETIC_DEV_TEST=true\n');
      const receipt = join(directory, 'signal.txt');
      const preload = join(directory, 'child-fixture.mjs');
      // Exercise the real launcher handlers without starting Turbo or services,
      // including on Windows where SIGTERM would forcibly terminate a process.
      writeFileSync(
        preload,
        `import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
childProcess.spawn = () => {
  const child = new EventEmitter();
  const timeout = setTimeout(() => process.exit(99), 2000);
  child.kill = (signal) => {
    setTimeout(() => {
      writeFileSync(${JSON.stringify(receipt)}, signal);
      clearTimeout(timeout);
      child.emit('exit', 23, null);
    }, 30);
    return true;
  };
  setTimeout(() => process.emit('${signal}'), 0);
  return child;
};
syncBuiltinESMExports();`,
      );
      const result = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, join(directory, 'scripts', 'dev.mjs')], {
        encoding: 'utf8',
        timeout: 5000,
      });
      assert.equal(result.status, 23, result.stderr);
      assert.equal(readFileSync(receipt, 'utf8'), signal);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
