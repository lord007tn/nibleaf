import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { diagnose } from './coolify-read-diagnostic.mjs';

const env = {
  COOLIFY_NIBLEAF_DEPLOY_WEBHOOK: 'https://provider.invalid/api/v1/deploy?uuid=synthetic-app&force=false',
  COOLIFY_NIBLEAF_API_TOKEN: 'private-token-sentinel',
  COOLIFY_CF_ACCESS_CLIENT_ID: 'private-client-sentinel',
  COOLIFY_CF_ACCESS_CLIENT_SECRET: 'private-secret-sentinel',
  NIBLEAF_COOLIFY_EXPECTED_SERVER_UUID: 'synthetic-server',
  NIBLEAF_COOLIFY_EXPECTED_SERVER_ID: '101',
};
const deployment = (status = 'queued') => ({
  deployment_uuid: 'synthetic-deployment',
  application_id: 42,
  server_id: 101,
  status,
  logs: 'private-log-sentinel',
});
const defaults = () => [
  { uuid: 'synthetic-app', status: 'running:healthy', private_key: 'private-key-sentinel' },
  [{ uuid: 'synthetic-server', ip: 'private-host-sentinel', name: 'private-name-sentinel', settings: { secret: 'nested-secret-sentinel' } }],
  [],
  { count: 1, deployments: [deployment('finished')] },
];
const json = (body) => Response.json(body);
async function fixture(values = defaults(), config = env) {
  const calls = [];
  const result = await diagnose(config, async (url, options) => {
    calls.push({ url, options });
    const value = values[calls.length - 1];
    if (value instanceof Error) throw value;
    return value instanceof Response ? value : json(value);
  });
  return { result, calls };
}

test('only four fixed GETs; credentials remain on trusted origin; no follow-ups or request body', async () => {
  const { result, calls } = await fixture();
  assert.equal(result.success, true);
  assert.deepEqual(
    calls.map(({ url }) => url.pathname + url.search),
    ['/api/v1/applications/synthetic-app', '/api/v1/servers', '/api/v1/deployments', '/api/v1/deployments/applications/synthetic-app?skip=0&take=20'],
  );
  for (const { url, options } of calls) {
    assert.equal(url.origin, 'https://provider.invalid');
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.equal(options.body, undefined);
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.headers.authorization, `Bearer ${env.COOLIFY_NIBLEAF_API_TOKEN}`);
  }
  assert.equal(result.visibility, 'unknown');
  assert.equal(result.serverIdle, 'unknown');
  assert.equal(result.applicationServerMatch, 'unknown');
  assert.equal(result.requests[2].count, 0);
  assert.equal(result.requests[2].targetQueueCount, 0);
});

test('all response metadata, IDs, credentials and nested values stay out of serialized output', async () => {
  const { result } = await fixture();
  const output = JSON.stringify(result);
  for (const secret of ['private-', 'nested-secret', 'synthetic-', '101', '42', 'provider.invalid', ...Object.values(env)]) {
    assert.equal(output.includes(secret), false, secret);
  }
  assert.equal(result.requests[1].expectedServerUuidPresent, true);
});

test('missing expected server and valid nonmatching server fail closed without host adoption', async () => {
  const missing = await fixture(defaults(), { ...env, NIBLEAF_COOLIFY_EXPECTED_SERVER_UUID: undefined });
  assert.equal(missing.result.requests[1].expectedServerUuidPresent, null);
  assert.equal(missing.result.success, false);
  const values = defaults();
  values[1] = [{ uuid: 'other-server', ip: 'same-claimed-host' }];
  const other = await fixture(values);
  assert.equal(other.result.requests[1].expectedServerUuidPresent, false);
  assert.equal(other.result.success, false);
  assert.equal(other.result.requests[2].targetQueueCount, null);
});

test('target queue count uses the masked numeric mapping only after UUID visibility is validated', async () => {
  const values = defaults();
  values[2] = [deployment(), { ...deployment(), deployment_uuid: 'other-deployment', server_id: 102 }];
  const visible = await fixture(values);
  assert.equal(visible.result.requests[2].count, 2);
  assert.equal(visible.result.requests[2].targetQueueCount, 1);
  assert.equal(visible.result.visibility, 'unknown');
  assert.equal(visible.result.serverIdle, 'unknown');
  const missing = await fixture(values, { ...env, NIBLEAF_COOLIFY_EXPECTED_SERVER_ID: undefined });
  assert.equal(missing.result.requests[2].targetQueueCount, null);
  assert.equal(missing.result.success, false);
  values[1] = new Response('private-denial', { status: 403 });
  const denied = await fixture(values);
  assert.equal(denied.result.requests[2].targetQueueCount, null);
});

test('installed API hides numeric IDs: UUID-only rows work and numeric-ID-only servers are rejected', async () => {
  const valid = await fixture();
  assert.equal(valid.result.requests[0].outcome, 'ok');
  assert.equal(valid.result.requests[1].expectedServerUuidPresent, true);
  const values = defaults();
  values[1] = [{ id: 101 }];
  const invalid = await fixture(values);
  assert.equal(invalid.result.requests[1].outcome, 'invalid_rows');
  assert.equal(invalid.result.success, false);
  values[1] = [{ uuid: 'synthetic-server' }, { uuid: 'synthetic-server' }];
  assert.equal((await fixture(values)).result.requests[1].outcome, 'invalid_rows');
  const badConfig = await fixture([], { ...env, NIBLEAF_COOLIFY_EXPECTED_SERVER_UUID: '../server' });
  assert.equal(badConfig.calls.length, 0);
  assert.equal(badConfig.result.configuration, 'invalid');
});

test('invalid trusted configuration makes no requests and cannot leak parser errors', async () => {
  for (const webhook of [
    'not a URL private-secret',
    'http://provider.invalid/deploy?uuid=a',
    'https://user:pass@provider.invalid/deploy?uuid=a',
    'https://provider.invalid/deploy?uuid=../other',
    'https://provider.invalid/deploy?uuid=a&uuid=b',
  ]) {
    const { result, calls } = await fixture([], { ...env, COOLIFY_NIBLEAF_DEPLOY_WEBHOOK: webhook });
    assert.equal(calls.length, 0);
    assert.equal(result.configuration, 'invalid');
    assert.equal(JSON.stringify(result).includes(webhook), false);
  }
});

test('queue supports arrays and sparse numeric-keyed objects, but not ambiguous envelopes or bad rows', async () => {
  for (const queue of [[deployment()], { 4: deployment() }]) {
    const values = defaults();
    values[2] = queue;
    const { result } = await fixture(values);
    assert.equal(result.requests[2].count, 1);
    assert.equal(result.requests[2].statusCounts.queued, 1);
  }
  for (const queue of [
    { deployments: [] },
    { message: 'private-error' },
    [null],
    [{ status: 'queued' }],
    [deployment(), deployment()],
    { x: deployment() },
  ]) {
    const values = defaults();
    values[2] = queue;
    const { result } = await fixture(values);
    assert.equal(result.success, false);
    assert.ok(['invalid_rows', 'unrecognized_shape'].includes(result.requests[2].outcome));
    assert.equal(result.requests[2].count, undefined);
  }
});

test('unexpected status is counted only as unknown and never echoed', async () => {
  const values = defaults();
  values[2] = [deployment('private-status-sentinel')];
  const { result } = await fixture(values);
  assert.equal(result.requests[2].statusCounts.unknown, 1);
  assert.equal(JSON.stringify(result).includes('private-status-sentinel'), false);
});

test('HTTP errors, redirects, HTML, invalid JSON, and thrown URL/token errors are sanitized', async () => {
  const examples = [
    [new Response('private-error-sentinel', { status: 403 }), 'http_error'],
    [new Response('private-redirect-sentinel', { status: 302, headers: { location: 'https://other.invalid/private-token' } }), 'redirect_rejected'],
    [new Response('<html>private-value</html>', { headers: { 'content-type': 'text/html' } }), 'non_json'],
    [new Response('private-invalid-json', { headers: { 'content-type': 'application/json' } }), 'invalid_json'],
    [new Error('https://provider.invalid/private-token-sentinel'), 'request_failed'],
  ];
  for (const [value, outcome] of examples) {
    const values = defaults();
    values[0] = value;
    const { result, calls } = await fixture(values);
    assert.equal(result.requests[0].outcome, outcome);
    assert.equal(JSON.stringify(result).includes('private-'), false);
    assert.equal(calls.length, 4);
    assert.equal(result.success, false);
  }
});

test('streamed body and declared lengths are bounded and oversized streams cancelled', async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array(600_000));
    },
    cancel() {
      cancelled = true;
    },
  });
  const values = defaults();
  values[0] = new Response(stream, { headers: { 'content-type': 'application/json' } });
  assert.equal((await fixture(values)).result.requests[0].outcome, 'body_limit');
  assert.equal(cancelled, true);
  const declared = defaults();
  declared[0] = new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '1048577' } });
  assert.equal((await fixture(declared)).result.requests[0].outcome, 'body_limit');
});

test('row caps, history totals and mismatched application identity fail closed', async () => {
  const fixtures = [
    [0, { id: 42, uuid: 'another-app', status: 'running' }, 'unrecognized_shape'],
    [1, Array.from({ length: 201 }, (_, id) => ({ uuid: `server-${id}` })), 'row_limit'],
    [2, Array.from({ length: 201 }, (_, id) => ({ ...deployment(), deployment_uuid: `row-${id}` })), 'row_limit'],
    [3, { count: 21, deployments: Array.from({ length: 21 }, (_, id) => ({ ...deployment(), deployment_uuid: `row-${id}` })) }, 'row_limit'],
    [3, { count: 0, deployments: [deployment()] }, 'invalid_rows'],
  ];
  for (const [index, value, outcome] of fixtures) {
    const values = defaults();
    values[index] = value;
    const { result } = await fixture(values);
    assert.equal(result.requests[index].outcome, outcome);
    assert.equal(result.success, false);
  }
});

test('workflow is manual-only, input-free, read-only and has no artifact or build steps', () => {
  const workflow = readFileSync(new URL('../.github/workflows/coolify-read-diagnostic.yml', import.meta.url), 'utf8');
  assert.match(workflow, /on:\s+workflow_dispatch:\s+permissions:/);
  assert.match(workflow, /permissions:\s+contents: read/);
  assert.match(workflow, /if: github.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /secrets\.NIBLEAF_COOLIFY_EXPECTED_SERVER_UUID/);
  assert.match(workflow, /secrets\.NIBLEAF_COOLIFY_EXPECTED_SERVER_ID/);
  assert.doesNotMatch(workflow, /vars\./);
  assert.doesNotMatch(workflow, /\b(inputs|push|pull_request|schedule|workflow_call):|upload-artifact|docker|pnpm|npm install|PATCH|POST/);
});
