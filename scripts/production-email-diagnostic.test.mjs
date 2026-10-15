import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { diagnoseEmail, emailDiagnosticSummary } from './production-email-diagnostic.mjs';

const NOW = Date.parse('2026-10-15T21:30:00.000Z');
const env = {
  COOLIFY_NIBLEAF_DEPLOY_WEBHOOK: 'https://provider.invalid/api/v1/deploy?uuid=synthetic-app&force=false',
  COOLIFY_NIBLEAF_API_TOKEN: 'private-coolify-token',
  COOLIFY_CF_ACCESS_CLIENT_ID: 'private-client-id',
  COOLIFY_CF_ACCESS_CLIENT_SECRET: 'private-client-secret',
  NIBLEAF_POSTMARK_API_KEY: 'private-repair-token',
};
const subject = 'Your Nibleaf sign-in code';
const line = (event, time = '2026-10-15T21:29:59.123456789Z') => `${time} ${JSON.stringify(event)}`;
const control = () =>
  Response.json({ message: "No running container found for service_name 'nibleaf-diagnostic-nonexistent-worker'." }, { status: 404 });
const defaults = () => [
  control(),
  { logs: `${line({ message: 'email sent', recipient: 'private-recipient@example.invalid', secret: 'private-log-secret' })}\n` },
  [{ key: 'POSTMARK_API_KEY', real_value: 'private-postmark-token', is_preview: false }],
  { ID: 12_345_678, DeliveryType: 'Live', ApiTokens: ['private-response-token'] },
  {
    TotalCount: 1,
    Messages: [
      {
        Subject: subject,
        ReceivedAt: '2026-10-15T17:29:59.1234567-04:00',
        Status: 'Sent',
        To: ['private-recipient@example.invalid'],
        MessageID: 'private-message-id',
        HtmlBody: 'private-body',
      },
    ],
  },
];
async function fixture({ values = defaults(), config = env, timeoutMs } = {}) {
  const calls = [];
  const result = await diagnoseEmail(
    config,
    async (url, options) => {
      calls.push({ url, options });
      const value = values[calls.length - 1];
      if (value instanceof Error) throw value;
      return value instanceof Response ? value : Response.json(value);
    },
    { now: () => NOW, ...(timeoutMs ? { timeoutMs } : {}) },
  );
  return { result, calls };
}

test('default diagnostic proves the deployed selector before reading only worker logs and the actual OTP subject', async () => {
  const { result, calls } = await fixture();
  assert.equal(result.success, true);
  assert.equal(result.observedAt, '2026-10-15T21:30:00.000Z');
  assert.equal(result.delivery, 'not_verified');
  assert.equal(result.worker.selector, 'verified');
  assert.equal(result.worker.fresh, true);
  assert.equal(result.worker.counts.sent, 1);
  assert.equal(result.provider.latestReceivedAt, '2026-10-15T21:29:59.123Z');
  assert.equal(result.provider.retainedEnglishSignInCodeCount, 1);
  assert.equal(result.providerRepaired, false);
  assert.deepEqual(
    calls.map(({ url }) => url.origin),
    [
      'https://provider.invalid',
      'https://provider.invalid',
      'https://provider.invalid',
      'https://api.postmarkapp.com',
      'https://api.postmarkapp.com',
    ],
  );
  assert.deepEqual(
    calls.map(({ url }) => url.pathname),
    [
      '/api/v1/applications/synthetic-app/logs',
      '/api/v1/applications/synthetic-app/logs',
      '/api/v1/applications/synthetic-app/envs',
      '/server',
      '/messages/outbound',
    ],
  );
  assert.deepEqual(Object.fromEntries(calls[0].url.searchParams), {
    lines: '1',
    service_name: 'nibleaf-diagnostic-nonexistent-worker',
    show_timestamps: 'true',
  });
  assert.deepEqual(Object.fromEntries(calls[1].url.searchParams), { lines: '500', service_name: 'worker', show_timestamps: 'true' });
  assert.deepEqual(Object.fromEntries(calls[4].url.searchParams), { count: '10', offset: '0', subject });
  for (const { options } of calls) {
    assert.equal(options.method, 'GET');
    assert.equal(options.body, undefined);
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
  }
  assert.equal(calls[0].options.headers.authorization, `Bearer ${env.COOLIFY_NIBLEAF_API_TOKEN}`);
  assert.equal(calls[3].options.headers.authorization, undefined);
  assert.equal(calls[3].options.headers['cf-access-client-secret'], undefined);
  assert.equal(calls[3].options.headers['x-postmark-server-token'], 'private-postmark-token');
  const english = JSON.parse(readFileSync(new URL('../packages/i18n/messages/en.json', import.meta.url), 'utf8'));
  assert.equal(subject, english.email_otp_signin_subject);
});

test('an ignored selector, generic404 or different service404 fails closed before env reads or explicit repair', async () => {
  for (const response of [
    Response.json({ logs: line({ message: 'email sent' }) }),
    Response.json({ message: 'Application not found.' }, { status: 404 }),
    Response.json({ message: "No running container found for service_name 'other'." }, { status: 404 }),
    new Response('private-auth-error', { status: 403 }),
  ]) {
    const { result, calls } = await fixture({ values: [response], config: { ...env, REPAIR_PROVIDER: 'true' } });
    assert.equal(result.success, false);
    assert.equal(result.worker.selector, 'unverified');
    assert.equal(calls.length, 1);
    assert.equal(result.providerRepaired, false);
    assert.doesNotMatch(JSON.stringify(result), /private-|Application not found|other/);
  }
});

test('empty, malformed, untimestamped, nonstructured and overlong worker samples cannot become zero-job success', async () => {
  for (const [sample, outcome] of [
    [{}, 'empty_or_invalid_logs'],
    [{ logs: [] }, 'empty_or_invalid_logs'],
    [{ logs: '  \n ' }, 'empty_or_invalid_logs'],
    [{ logs: JSON.stringify({ message: 'email sent' }) }, 'missing_or_invalid_log_timestamps'],
    [{ logs: line({ message: 'email sent' }, '2026-02-30T21:29:59Z') }, 'missing_or_invalid_log_timestamps'],
    [{ logs: '2026-10-15T21:29:59Z plain text private-log' }, 'unrecognized_log_format'],
    [{ logs: Array.from({ length: 501 }, () => line({ message: 'heartbeat' })).join('\n') }, 'log_row_limit'],
  ]) {
    const values = defaults();
    values[1] = sample;
    const { result, calls } = await fixture({ values });
    assert.equal(result.outcome, outcome);
    assert.equal(result.success, false);
    assert.equal(calls.length, 2);
  }
});

test('stale and future samples fail; timestamp boundaries, nanoseconds, CRLF and zero matches are explicit', async () => {
  for (const [time, outcome] of [
    ['2026-10-15T21:14:59.999Z', 'stale_worker_sample'],
    ['2026-10-15T21:31:00.001Z', 'future_log_timestamps'],
    ['2026-10-15T21:15:00Z', 'diagnostic_complete_delivery_not_verified'],
  ]) {
    const values = defaults();
    values[1] = { logs: `${line({ msg: 'heartbeat' }, time)}\r\n` };
    values[4] = { TotalCount: 0, Messages: [] };
    const { result } = await fixture({ values });
    assert.equal(result.outcome, outcome);
    if (result.success) {
      assert.equal(result.worker.evidence, 'zero_matches_inconclusive');
      assert.equal(result.provider.evidence, 'zero_matches_inconclusive');
      assert.equal(result.delivery, 'not_verified');
    }
  }
});

test('counters use exact structured event messages, not substrings in arbitrary content or error fields', async () => {
  const values = defaults();
  values[1] = {
    logs: [
      line({ message: 'email sent' }),
      line({ msg: 'email delivery failed' }),
      line({ message: 'email delivery is optional and no provider is configured' }),
      line({ message: 'email logged, not sent' }),
      line({ message: 'request complete', error: 'email sent', recipient: 'private-recipient@example.invalid' }),
      '2026-10-15T21:29:59Z email sent private-unstructured',
    ].join('\n'),
  };
  const { result } = await fixture({ values });
  assert.equal(result.success, true);
  assert.deepEqual(result.worker.counts, { sent: 1, failed: 1, optionalUndelivered: 2 });
  assert.equal(result.worker.structuredRows, 5);
  assert.equal(result.worker.returnedLines, 6);
  assert.equal(result.worker.evidence, 'sampled_jobs_only');
  assert.equal(result.delivery, 'not_verified');
});

test('only explicit true can repair a missing provider; existing Postmark or SMTP is never overwritten', async () => {
  for (const mode of [undefined, '', 'false']) {
    const values = defaults();
    values[2] = [];
    const { result, calls } = await fixture({ values, config: { ...env, REPAIR_PROVIDER: mode } });
    assert.equal(result.outcome, 'provider_not_configured');
    assert.equal(result.providerRepaired, false);
    assert.ok(calls.every(({ options }) => options.method === 'GET'));
  }
  const values = defaults();
  values[2] = [];
  values.splice(3, 0, Response.json({ value: 'private-repair-response' }, { status: 201 }));
  const repaired = await fixture({ values, config: { ...env, REPAIR_PROVIDER: 'true' } });
  assert.equal(repaired.result.success, true);
  assert.equal(repaired.result.providerRepaired, true);
  assert.deepEqual(
    repaired.calls
      .filter(({ options }) => options.method !== 'GET')
      .map(({ url, options }) => ({ path: url.pathname, method: options.method, body: JSON.parse(options.body) })),
    [
      {
        path: '/api/v1/applications/synthetic-app/envs',
        method: 'POST',
        body: { key: 'POSTMARK_API_KEY', value: env.NIBLEAF_POSTMARK_API_KEY, is_preview: false, is_literal: true },
      },
    ],
  );
  for (const provider of [
    [{ key: 'POSTMARK_API_KEY', value: 'private-existing-token' }],
    [{ key: 'SMTP_URL', value: 'smtp://private-user:private-pass@private-host' }],
  ]) {
    const existing = defaults();
    existing[2] = provider;
    const { result, calls } = await fixture({ values: existing, config: { ...env, REPAIR_PROVIDER: 'true' } });
    assert.equal(result.success, true);
    assert.equal(result.providerRepaired, false);
    assert.ok(calls.every(({ options }) => options.method === 'GET'));
  }
  const missing = defaults();
  missing[2] = [];
  const noSecret = await fixture({ values: missing, config: { ...env, REPAIR_PROVIDER: 'true', NIBLEAF_POSTMARK_API_KEY: '' } });
  assert.equal(noSecret.result.outcome, 'missing_repair_secret');
  assert.equal(noSecret.calls.length, 3);
});

test('invalid target configuration never requests or adopts applications from a provider list', async () => {
  for (const webhook of [
    'not a url private-sentinel',
    'http://provider.invalid/deploy?uuid=a',
    'https://user:private-password@provider.invalid/deploy?uuid=a',
    'https://provider.invalid//attacker.invalid/deploy?uuid=a',
    'https://provider.invalid/\\attacker.invalid/deploy?uuid=a',
    'https://provider.invalid/api/v1/deploy?uuid=../a',
    'https://provider.invalid/api/v1/deploy?uuid=a&uuid=b',
    'https://provider.invalid/api/v1/deploy',
  ]) {
    const { result, calls } = await fixture({ config: { ...env, COOLIFY_NIBLEAF_DEPLOY_WEBHOOK: webhook } });
    assert.equal(result.outcome, 'invalid_configuration');
    assert.equal(calls.length, 0);
  }
  for (const value of ['TRUE', true, 'yes', '1']) {
    const { result, calls } = await fixture({ config: { ...env, REPAIR_PROVIDER: value } });
    assert.equal(result.outcome, 'invalid_configuration');
    assert.equal(calls.length, 0);
  }
});

test('response bodies, declared sizes, streamed sizes, redirects and raw errors remain bounded and redacted', async () => {
  for (const [response, outcome] of [
    [new Response('private-error', { status: 302, headers: { location: 'https://attacker.invalid' } }), 'redirect_rejected'],
    [new Response('private-error', { status: 404, headers: { 'content-type': 'text/html' } }), 'non_json'],
    [new Response('private-json', { status: 404, headers: { 'content-type': 'application/json' } }), 'invalid_json'],
    [new Response('{}', { status: 404, headers: { 'content-type': 'application/json', 'content-length': '1048577' } }), 'body_limit'],
    [new Error('private-network-credential'), 'request_failed'],
  ]) {
    const { result } = await fixture({ values: [response] });
    assert.equal(result.outcome, outcome);
    assert.doesNotMatch(JSON.stringify(result), /private-|attacker/);
  }
  let cancelled = false;
  const stream = new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array(600_000));
    },
    cancel() {
      cancelled = true;
    },
  });
  const { result } = await fixture({ values: [new Response(stream, { status: 404, headers: { 'content-type': 'application/json' } })] });
  assert.equal(result.outcome, 'body_limit');
  assert.equal(cancelled, true);
});

test('deadline covers both a stalled fetch and stalled body, aborting without leaking raw request failures', async () => {
  let signal;
  const waiting = await diagnoseEmail(
    env,
    async (_url, options) => {
      signal = options.signal;
      return await new Promise(() => undefined);
    },
    { now: () => NOW, timeoutMs: 20 },
  );
  assert.equal(waiting.outcome, 'request_timeout');
  assert.equal(signal.aborted, true);
  let cancelled = false;
  const stalled = new ReadableStream({
    cancel() {
      cancelled = true;
    },
  });
  const body = await fixture({ values: [new Response(stalled, { status: 404, headers: { 'content-type': 'application/json' } })], timeoutMs: 20 });
  assert.equal(body.result.outcome, 'request_timeout');
  assert.equal(cancelled, true);
});

test('malformed environment and provider metadata cannot escape into diagnostics or trigger repair', async () => {
  for (const [index, data, outcome] of [
    [
      2,
      [
        { key: 'POSTMARK_API_KEY', value: 'private-a' },
        { key: 'POSTMARK_API_KEY', value: 'private-b' },
      ],
      'ambiguous_environment',
    ],
    [2, [{ key: 'POSTMARK_API_KEY', value: 'private-token\n::error::injection' }], 'invalid_environment_value'],
    [2, Array.from({ length: 501 }, () => ({})), 'invalid_environment_shape'],
    [3, { DeliveryType: 'Sandbox', ApiTokens: ['private-token'] }, 'provider_not_live'],
    [3, { DeliveryType: 'private-mode' }, 'invalid_provider_server'],
    [4, { TotalCount: 1, Messages: [] }, 'invalid_provider_messages'],
    [4, { TotalCount: -1, Messages: [] }, 'invalid_provider_messages'],
    [4, { TotalCount: 11, Messages: Array.from({ length: 11 }, () => ({})) }, 'invalid_provider_messages'],
    [
      4,
      { TotalCount: 1, Messages: [{ Subject: subject, Status: 'private-status\n::error::', ReceivedAt: '2026-10-15T21:29:59Z' }] },
      'invalid_provider_status',
    ],
    [4, { TotalCount: 1, Messages: [{ Subject: subject, Status: 'Sent', ReceivedAt: 'private-time' }] }, 'invalid_provider_messages'],
  ]) {
    const values = defaults();
    values[index] = data;
    const { result } = await fixture({ values, config: { ...env, REPAIR_PROVIDER: 'true' } });
    assert.equal(result.outcome, outcome);
    assert.equal(result.success, false);
    assert.equal(result.providerRepaired, false);
    assert.doesNotMatch(JSON.stringify(result), /private-|::error::/);
  }
});

test('output and summary contain only allowlisted aggregates; no raw logs, env, recipients, bodies, IDs or tokens', async () => {
  const { result } = await fixture();
  for (const output of [JSON.stringify(result), emailDiagnosticSummary(result)]) {
    assert.doesNotMatch(output, /private-|synthetic-app|provider\.invalid|12345678|MessageID|HtmlBody|ApiTokens|POSTMARK_API_KEY|@/);
    for (const value of Object.values(env)) assert.equal(output.includes(value), false);
  }
  assert.match(emailDiagnosticSummary(result), /Zero matches are inconclusive/);
  assert.match(emailDiagnosticSummary(result), /not a specific recipient or current request/);
});

test('workflow stays manual-only, defaults read-only, tests before secrets, and CI tests before installation without provider access', () => {
  const workflow = readFileSync(new URL('../.github/workflows/production-email-diagnostics.yml', import.meta.url), 'utf8');
  assert.match(workflow, /on:\s+workflow_dispatch:/);
  assert.match(workflow, /repair_provider:[\s\S]*?default: false/);
  assert.match(workflow, /if: github.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /node-version: 22/);
  assert.doesNotMatch(workflow, /\b(push|pull_request|schedule|workflow_call):|docker|upload-artifact|curl|add-mask/);
  assert.ok(workflow.indexOf('node --test scripts/production-email-diagnostic.test.mjs') < workflow.indexOf('secrets.COOLIFY_'));
  const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.ok(ci.indexOf('node --test scripts/production-email-diagnostic.test.mjs') < ci.indexOf('pnpm install --frozen-lockfile'));
});
