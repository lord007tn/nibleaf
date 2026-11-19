import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

/** Run the actual built app against an in-memory, read-only private-preview API.
 * Call only inside the devstack lock, after builds and outside the heavy slot. */
export async function withPrivatePreviewRuntime(root, scratch, run, registerCleanup) {
  const requests = [];
  const api = createServer((request, response) => {
    requests.push({ method: request.method, path: request.url });
    response.setHeader('content-type', 'application/json');
    if (request.method === 'GET' && request.url === '/api/app/health') {
      response.end('{"data":{"status":"ok"}}');
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Fictional private preview', details: { reason: 'private' } } }));
  });
  let app;
  const log = createWriteStream(join(scratch, 'preview-runtime.log'));
  let stopping;
  const stop = () => {
    stopping ??= (async () => {
      try {
        if (app && app.exitCode === null && app.signalCode === null) {
          const exited = new Promise((resolve) => app.once('exit', resolve));
          app.kill('SIGTERM');
          await Promise.race([exited, delay(5000)]);
          if (app.exitCode === null && app.signalCode === null) {
            app.kill('SIGKILL');
            await Promise.race([exited, delay(5000)]);
          }
          assert.ok(app.exitCode !== null || app.signalCode !== null, 'Owned app must stop before releasing the devstack lock');
        }
      } finally {
        api.closeAllConnections();
        await new Promise((resolve) => api.close(resolve));
        log.end();
      }
    })();
    return stopping;
  };
  registerCleanup(stop);
  try {
    await new Promise((resolve, reject) => {
      api.once('error', reject);
      api.listen(4410, '127.0.0.1', resolve);
    });
    assert.ok(!stopping, 'Capture was interrupted before app startup');
    const env = Object.fromEntries(
      ['PATH', 'Path', 'SystemRoot', 'TEMP', 'TMP'].filter((key) => process.env[key]).map((key) => [key, process.env[key]]),
    );
    app = spawn(process.execPath, [join(root, 'apps/app/.output/server/index.mjs')], {
      cwd: root,
      env: {
        ...env,
        NODE_ENV: 'production',
        NITRO_HOST: '127.0.0.1',
        NITRO_PORT: '4310',
        PORT: '4310',
        APP_URL: 'http://localhost:4310',
        BETTER_AUTH_URL: 'http://localhost:4310',
        BETTER_AUTH_SECRET: 'fixture'.repeat(8),
        POSTGRES_URL: 'postgresql://fixture:fixture@127.0.0.1:1/fixture',
        REDIS_HOST: '127.0.0.1',
        REDIS_PORT: '1',
        NIBLEAF_REVISION: 'ui-627-local-fixture',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    app.stdout.pipe(log, { end: false });
    app.stderr.pipe(log, { end: false });
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (app.exitCode !== null || app.signalCode !== null)
        throw new Error(`Fixture app exited: ${app.exitCode ?? app.signalCode}; see preview-runtime.log`);
      try {
        const response = await fetch('http://localhost:4310/health', { signal: AbortSignal.timeout(1000) });
        ready = response.ok && response.headers.get('x-nibleaf-revision') === 'ui-627-local-fixture';
      } catch {
        /* The owned listener is still starting. */
      }
      if (ready) break;
      await delay(200);
    }
    assert.ok(ready, 'The exact owned production app must become ready');
    const result = await run();
    assert.ok(
      requests.every((request) => request.method === 'GET'),
      'The fixture API accepts only reads',
    );
    return { appPid: app.pid, requests, result };
  } finally {
    await stop();
  }
}
