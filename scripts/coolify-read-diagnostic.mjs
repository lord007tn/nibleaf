import { pathToFileURL } from 'node:url';

const MAX_BYTES = 1024 * 1024;
const MAX_ROWS = 200;
const TIMEOUT_MS = 10_000;
const statuses = ['queued', 'in_progress', 'finished', 'failed', 'cancelled-by-user'];
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const identifier = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const numericId = (value) => Number.isSafeInteger(value) && value >= 0;
const fail = (code) => {
  throw new DiagnosticError(code);
};
class DiagnosticError extends Error {}

function configuration(env) {
  const names = ['COOLIFY_NIBLEAF_DEPLOY_WEBHOOK', 'COOLIFY_NIBLEAF_API_TOKEN', 'COOLIFY_CF_ACCESS_CLIENT_ID', 'COOLIFY_CF_ACCESS_CLIENT_SECRET'];
  if (names.some((name) => typeof env[name] !== 'string' || !env[name].trim())) fail('invalid_configuration');
  let webhook;
  try {
    webhook = new URL(env.COOLIFY_NIBLEAF_DEPLOY_WEBHOOK);
  } catch {
    fail('invalid_configuration');
  }
  if (webhook.protocol !== 'https:' || webhook.username || webhook.password || webhook.hash || !webhook.pathname.endsWith('/deploy'))
    fail('invalid_configuration');
  const uuid = webhook.searchParams.get('uuid');
  if (webhook.searchParams.getAll('uuid').length !== 1 || !identifier(uuid)) fail('invalid_configuration');
  const base = new URL(webhook.origin);
  base.pathname = webhook.pathname.slice(0, -'/deploy'.length);
  const expected = env.NIBLEAF_COOLIFY_EXPECTED_SERVER_UUID;
  if (expected && !identifier(expected)) fail('invalid_configuration');
  // The server endpoint hides numeric IDs. This mapping is supplied privately
  // by the operator; never infer it from application destination fields.
  const expectedId = env.NIBLEAF_COOLIFY_EXPECTED_SERVER_ID;
  if (expectedId && (!/^(0|[1-9]\d*)$/.test(expectedId) || !numericId(Number(expectedId)))) fail('invalid_configuration');
  return {
    base,
    uuid,
    expectedServer: expected || undefined,
    expectedServerId: expectedId ? Number(expectedId) : undefined,
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${env.COOLIFY_NIBLEAF_API_TOKEN}`,
      'cf-access-client-id': env.COOLIFY_CF_ACCESS_CLIENT_ID,
      'cf-access-client-secret': env.COOLIFY_CF_ACCESS_CLIENT_SECRET,
    },
  };
}

async function readJson(response) {
  if (!/^application\/(?:[\w.-]+\+)?json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) fail('non_json');
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)) fail('body_limit');
  if (!response.body) fail('invalid_json');
  const reader = response.body.getReader();
  let bytes = 0;
  const chunks = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) fail('body_limit');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } catch {
    fail('invalid_json');
  }
}

function rows(value, limit = MAX_ROWS) {
  let result;
  let shape;
  if (Array.isArray(value)) {
    result = value;
    shape = 'array';
  } else if (record(value) && Object.keys(value).every((key) => /^(0|[1-9]\d*)$/.test(key))) {
    result = Object.values(value);
    shape = 'indexed_object';
  } else fail('unrecognized_shape');
  if (result.length > limit) fail('row_limit');
  if (result.some((row) => !record(row))) fail('invalid_rows');
  return { result, shape };
}

function deployments(value, limit, expectedServerId) {
  const { result, shape } = rows(value, limit);
  const counts = Object.fromEntries([...statuses, 'unknown'].map((status) => [status, 0]));
  const seen = new Set();
  for (const row of result) {
    if (
      !identifier(row.deployment_uuid) ||
      seen.has(row.deployment_uuid) ||
      !numericId(row.server_id) ||
      !numericId(row.application_id) ||
      typeof row.status !== 'string' ||
      !row.status ||
      row.status.length > 64
    )
      fail('invalid_rows');
    seen.add(row.deployment_uuid);
    counts[statuses.includes(row.status) ? row.status : 'unknown']++;
  }
  return {
    shape,
    count: result.length,
    statusCounts: counts,
    ...(expectedServerId === undefined ? {} : { targetQueueCount: result.filter((row) => row.server_id === expectedServerId).length }),
  };
}

function summarize(kind, data, config, serverUuidVisible) {
  if (kind === 'application') {
    if (!record(data) || data.uuid !== config.uuid || typeof data.status !== 'string') fail('unrecognized_shape');
    // Application destination/server relations vary by API version. No guessed mapping.
    return { shape: 'application_object', applicationServerMatch: 'unknown' };
  }
  if (kind === 'servers') {
    const { result, shape } = rows(data);
    if (result.some((row) => !identifier(row.uuid)) || new Set(result.map((row) => row.uuid)).size !== result.length) fail('invalid_rows');
    return {
      shape,
      count: result.length,
      expectedServerUuidPresent: config.expectedServer === undefined ? null : result.some((row) => row.uuid === config.expectedServer),
    };
  }
  if (kind === 'queue') return { targetQueueCount: null, ...deployments(data, MAX_ROWS, serverUuidVisible ? config.expectedServerId : undefined) };
  if (!record(data) || !numericId(data.count) || !Object.hasOwn(data, 'deployments')) fail('unrecognized_shape');
  const summary = deployments(data.deployments, 20);
  if (data.count < summary.count) fail('invalid_rows');
  return { ...summary, shape: 'history_object', returnedShape: summary.shape, totalCount: data.count };
}

export async function diagnose(env, fetchImpl = fetch) {
  let config;
  const output = { visibility: 'unknown', serverIdle: 'unknown', applicationServerMatch: 'unknown', requests: [] };
  try {
    config = configuration(env);
  } catch {
    return { ...output, configuration: 'invalid', success: false };
  }
  const endpoints = [
    ['application', `/applications/${config.uuid}`],
    ['servers', '/servers'],
    ['queue', '/deployments'],
    ['history', `/deployments/applications/${config.uuid}?skip=0&take=20`],
  ];
  for (const [kind, path] of endpoints) {
    const report = { kind };
    let response;
    try {
      response = await fetchImpl(new URL(`${config.base.pathname}${path}`, config.base), {
        method: 'GET',
        headers: config.headers,
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!Number.isInteger(response.status) || response.status < 100 || response.status > 599) fail('invalid_response');
      report.httpStatus = response.status;
      if (response.redirected || (response.status >= 300 && response.status < 400)) fail('redirect_rejected');
      if (!response.ok) fail('http_error');
      const serverUuidVisible = output.requests.find((item) => item.kind === 'servers')?.expectedServerUuidPresent === true;
      Object.assign(report, summarize(kind, await readJson(response), config, serverUuidVisible), { outcome: 'ok' });
    } catch (error) {
      report.outcome = error instanceof DiagnosticError ? error.message : 'request_failed';
    } finally {
      await response?.body?.cancel().catch(() => undefined);
    }
    output.requests.push(report);
  }
  // A successful diagnostic is not authorization to deploy or a claim of idle servers.
  output.success =
    output.requests.every((item) => item.outcome === 'ok') &&
    output.requests.find((item) => item.kind === 'servers').expectedServerUuidPresent === true &&
    typeof output.requests.find((item) => item.kind === 'queue').targetQueueCount === 'number';
  return output;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await diagnose(process.env);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.success ? 0 : 1;
}
