import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const MAX_BYTES = 1024 * 1024;
const MAX_ROWS = 500;
const TIMEOUT_MS = 10_000;
const MAX_LOG_AGE_MS = 15 * 60_000;
const MAX_FUTURE_MS = 60_000;
const MISSING_SERVICE = 'nibleaf-diagnostic-nonexistent-worker';
const OTP_SUBJECT = 'Your Nibleaf sign-in code';
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const identifier = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
class DiagnosticError extends Error {}
const fail = (code) => {
  throw new DiagnosticError(code);
};

function configuration(env) {
  const names = ['COOLIFY_NIBLEAF_DEPLOY_WEBHOOK', 'COOLIFY_NIBLEAF_API_TOKEN', 'COOLIFY_CF_ACCESS_CLIENT_ID', 'COOLIFY_CF_ACCESS_CLIENT_SECRET'];
  if (names.some((name) => typeof env[name] !== 'string' || !env[name].trim())) fail('invalid_configuration');
  if (![undefined, '', 'false', 'true'].includes(env.REPAIR_PROVIDER)) fail('invalid_configuration');
  let webhook;
  try {
    webhook = new URL(env.COOLIFY_NIBLEAF_DEPLOY_WEBHOOK);
  } catch {
    fail('invalid_configuration');
  }
  if (
    webhook.protocol !== 'https:' ||
    webhook.username ||
    webhook.password ||
    webhook.hash ||
    webhook.pathname.startsWith('//') ||
    !webhook.pathname.endsWith('/deploy') ||
    webhook.searchParams.getAll('uuid').length !== 1 ||
    !identifier(webhook.searchParams.get('uuid'))
  )
    fail('invalid_configuration');
  return {
    base: new URL(`${webhook.origin}${webhook.pathname.slice(0, -'/deploy'.length)}/`),
    uuid: webhook.searchParams.get('uuid'),
    repair: env.REPAIR_PROVIDER === 'true',
    replacementToken: env.NIBLEAF_POSTMARK_API_KEY?.trim() ?? '',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${env.COOLIFY_NIBLEAF_API_TOKEN}`,
      'cf-access-client-id': env.COOLIFY_CF_ACCESS_CLIENT_ID,
      'cf-access-client-secret': env.COOLIFY_CF_ACCESS_CLIENT_SECRET,
    },
  };
}

async function readJson(response, signal) {
  if (!/^application\/(?:[\w.-]+\+)?json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) fail('non_json');
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)) fail('body_limit');
  if (!response.body) fail('invalid_json');
  const reader = response.body.getReader();
  const cancel = () => void reader.cancel().catch(() => undefined);
  signal.addEventListener('abort', cancel, { once: true });
  let bytes = 0;
  const chunks = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (signal.aborted) fail('request_timeout');
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) fail('body_limit');
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener('abort', cancel);
    cancel();
    reader.releaseLock();
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } catch {
    fail('invalid_json');
  }
}

// ISO-only input: never copy provider strings (including terminal/workflow escapes)
// into output. Docker timestamps can carry nanoseconds; aggregate at milliseconds.
function timestamp(value, allowOffset = false) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || (!allowOffset && match[3] !== 'Z')) return null;
  const local = `${match[1]}.${(match[2] ?? '').padEnd(3, '0').slice(0, 3)}`;
  const localTime = Date.parse(`${local}Z`);
  if (!Number.isFinite(localTime) || new Date(localTime).toISOString() !== `${local}Z`) return null;
  if (match[3] !== 'Z' && (Number(match[3].slice(1, 3)) > 23 || Number(match[3].slice(4)) > 59)) return null;
  const time = Date.parse(`${local}${match[3]}`);
  return Number.isFinite(time) ? time : null;
}

function summarizeLogs(data, now) {
  if (!record(data) || typeof data.logs !== 'string' || !data.logs.trim()) fail('empty_or_invalid_logs');
  const lines = data.logs.trimEnd().split(/\r?\n/);
  if (lines.length > MAX_ROWS) fail('log_row_limit');
  const times = [];
  const counts = { sent: 0, failed: 0, optionalUndelivered: 0 };
  let structuredRows = 0;
  for (const line of lines) {
    const split = line.indexOf(' ');
    const time = timestamp(line.slice(0, split));
    if (split < 0 || time === null) fail('missing_or_invalid_log_timestamps');
    if (time > now + MAX_FUTURE_MS) fail('future_log_timestamps');
    times.push(time);
    let event;
    try {
      event = JSON.parse(line.slice(split + 1));
    } catch {
      continue;
    }
    if (!record(event)) continue;
    const message = event.message ?? event.msg;
    if (typeof message !== 'string') continue;
    structuredRows++;
    if (message === 'email sent') counts.sent++;
    if (message === 'email delivery failed') counts.failed++;
    if (message === 'email delivery is optional and no provider is configured' || message === 'email logged, not sent') counts.optionalUndelivered++;
  }
  if (structuredRows === 0) fail('unrecognized_log_format');
  const latest = Math.max(...times);
  return {
    returnedLines: lines.length,
    structuredRows,
    oldestTimestamp: new Date(Math.min(...times)).toISOString(),
    latestTimestamp: new Date(latest).toISOString(),
    fresh: now - latest <= MAX_LOG_AGE_MS,
    maxAgeMinutes: MAX_LOG_AGE_MS / 60_000,
    counts,
    evidence: counts.sent + counts.failed + counts.optionalUndelivered === 0 ? 'zero_matches_inconclusive' : 'sampled_jobs_only',
  };
}

function providerConfiguration(data) {
  if (!Array.isArray(data) || data.length > MAX_ROWS || data.some((row) => !record(row))) fail('invalid_environment_shape');
  const values = {};
  for (const key of ['POSTMARK_API_KEY', 'SMTP_URL', 'POSTMARK_MESSAGE_STREAM']) {
    const matches = data.filter((row) => row.key === key && row.is_preview !== true);
    if (matches.length > 1) fail('ambiguous_environment');
    const value = matches[0]?.real_value ?? matches[0]?.value ?? '';
    if (typeof value !== 'string' || /[\r\n]/.test(value)) fail('invalid_environment_value');
    values[key] = value.trim();
  }
  if (values.POSTMARK_MESSAGE_STREAM && !identifier(values.POSTMARK_MESSAGE_STREAM)) fail('invalid_message_stream');
  return values;
}

function summarizeMessages(data, now) {
  if (
    !record(data) ||
    !Number.isSafeInteger(data.TotalCount) ||
    data.TotalCount < 0 ||
    !Array.isArray(data.Messages) ||
    data.Messages.length > 10 ||
    data.TotalCount < data.Messages.length ||
    (data.TotalCount > 0 && data.Messages.length === 0)
  )
    fail('invalid_provider_messages');
  let latest = null;
  let latestStatus = 'none';
  for (const message of data.Messages) {
    const time = timestamp(message?.ReceivedAt, true);
    if (!record(message) || message.Subject !== OTP_SUBJECT || time === null || time > now + MAX_FUTURE_MS) fail('invalid_provider_messages');
    if (!['Queued', 'Sent', 'Processed', 'Delivered', 'Bounced'].includes(message.Status)) fail('invalid_provider_status');
    if (latest === null || time > latest) {
      latest = time;
      latestStatus = message.Status;
    }
  }
  return {
    retainedEnglishSignInCodeCount: data.TotalCount,
    latestStatus,
    latestReceivedAt: latest === null ? null : new Date(latest).toISOString(),
    evidence: data.TotalCount === 0 ? 'zero_matches_inconclusive' : 'retained_messages_only',
  };
}

export async function diagnoseEmail(env, fetchImpl = fetch, { now = Date.now, timeoutMs = TIMEOUT_MS } = {}) {
  const result = {
    success: false,
    delivery: 'not_verified',
    providerRepaired: false,
    worker: { selector: 'unverified' },
    provider: { outcome: 'not_probed' },
  };
  let stage = 'configuration';
  try {
    const config = configuration(env);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > TIMEOUT_MS) fail('invalid_configuration');
    const observedAt = now();
    if (!Number.isFinite(observedAt)) fail('invalid_configuration');
    result.observedAt = new Date(observedAt).toISOString();
    const request = async (url, headers, { method = 'GET', body, expectedStatus = 200 } = {}) => {
      const controller = new AbortController();
      let response;
      let timer;
      try {
        return await Promise.race([
          (async () => {
            response = await fetchImpl(url, { method, headers, body, redirect: 'error', signal: controller.signal });
            if (response.redirected || (response.status >= 300 && response.status < 400)) fail('redirect_rejected');
            if (response.status !== expectedStatus) fail('unexpected_http_status');
            return await readJson(response, controller.signal);
          })(),
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              controller.abort();
              reject(new DiagnosticError('request_timeout'));
            }, timeoutMs);
          }),
        ]);
      } finally {
        clearTimeout(timer);
        controller.abort();
        void response?.body?.cancel().catch(() => undefined);
      }
    };
    const coolifyUrl = (path) => {
      const url = new URL(path, config.base);
      if (url.origin !== config.base.origin || !url.pathname.startsWith(config.base.pathname)) fail('origin_rejected');
      return url;
    };
    const logsUrl = (service, lines) => {
      const url = coolifyUrl(`applications/${config.uuid}/logs`);
      url.search = new URLSearchParams({ lines: String(lines), service_name: service, show_timestamps: 'true' }).toString();
      return url;
    };
    // Pin deployed behavior: older APIs ignore service_name and select the first
    // container. A generic404 does not prove service selection.
    // https://github.com/coollabsio/coolify/blob/1d0360949784f87d6aac39d59b2e41c1fd5402ec/app/Http/Controllers/Api/ApplicationsController.php
    stage = 'worker_selector';
    const control = await request(logsUrl(MISSING_SERVICE, 1), config.headers, { expectedStatus: 404 });
    if (!record(control) || control.message !== `No running container found for service_name '${MISSING_SERVICE}'.`) fail('selector_not_verified');
    result.worker.selector = 'verified';
    stage = 'worker_logs';
    Object.assign(result.worker, summarizeLogs(await request(logsUrl('worker', MAX_ROWS), config.headers), observedAt));
    if (!result.worker.fresh) fail('stale_worker_sample');

    stage = 'provider_configuration';
    const values = providerConfiguration(await request(coolifyUrl(`applications/${config.uuid}/envs`), config.headers));
    let token = values.POSTMARK_API_KEY;
    if (!token && !values.SMTP_URL && config.repair) {
      if (!config.replacementToken || /[\r\n]/.test(config.replacementToken)) fail('missing_repair_secret');
      await request(
        coolifyUrl(`applications/${config.uuid}/envs`),
        { ...config.headers, 'content-type': 'application/json' },
        {
          method: 'POST',
          expectedStatus: 201,
          body: JSON.stringify({ key: 'POSTMARK_API_KEY', value: config.replacementToken, is_preview: false, is_literal: true }),
        },
      );
      token = config.replacementToken;
      result.providerRepaired = true;
    }
    if (!token && !values.SMTP_URL) fail('provider_not_configured');
    if (token) {
      stage = 'provider_authentication';
      const headers = { accept: 'application/json', 'x-postmark-server-token': token };
      const server = await request(new URL('https://api.postmarkapp.com/server'), headers);
      if (!record(server) || !['Live', 'Sandbox'].includes(server.DeliveryType)) fail('invalid_provider_server');
      result.provider = { kind: 'postmark', authenticated: true, deliveryType: server.DeliveryType, outcome: 'not_probed' };
      if (server.DeliveryType !== 'Live') fail('provider_not_live');
      stage = 'provider_messages';
      const url = new URL('https://api.postmarkapp.com/messages/outbound');
      url.search = new URLSearchParams({
        count: '10',
        offset: '0',
        subject: OTP_SUBJECT,
        ...(values.POSTMARK_MESSAGE_STREAM ? { messagestream: values.POSTMARK_MESSAGE_STREAM } : {}),
      }).toString();
      Object.assign(result.provider, summarizeMessages(await request(url, headers), observedAt), { outcome: 'ok', subjectLanguage: 'en' });
    } else {
      result.provider = { kind: 'smtp', outcome: 'configured_authentication_not_probed' };
    }
    result.success = true;
    result.outcome = 'diagnostic_complete_delivery_not_verified';
  } catch (error) {
    result.outcome = error instanceof DiagnosticError ? error.message : 'request_failed';
    result.failedStage = stage;
  }
  return result;
}

export function emailDiagnosticSummary(result) {
  return `### Production email diagnostic evidence\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\`\n\nA successful diagnostic is not proof of OTP delivery. Zero matches are inconclusive. Worker counters cover only the bounded sample; provider totals cover retained English sign-in emails, not a specific recipient or current request.\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await diagnoseEmail(process.env);
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, emailDiagnosticSummary(result));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = result.success ? 0 : 1;
  } catch {
    process.stderr.write('Email diagnostic could not write its sanitized summary.\n');
    process.exitCode = 1;
  }
}
