import { appendFile } from 'node:fs/promises';

import { publicTargets, verifyTarget } from './coolify-release-probes.mjs';

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required release input: ${name}`);
  return value;
};

const sourceSha = required('NIBLEAF_SOURCE_SHA');
const rollbackTag = required('NIBLEAF_ROLLBACK_IMAGE_TAG');
const backupReference = required('NIBLEAF_BACKUP_REFERENCE');
const migrationEvidence = required('NIBLEAF_MIGRATION_EVIDENCE');
const migrationMode = required('NIBLEAF_MIGRATION_MODE');
const webhook = new URL(required('COOLIFY_NIBLEAF_DEPLOY_WEBHOOK'));
const token = required('COOLIFY_NIBLEAF_API_TOKEN');
const accessClientId = required('COOLIFY_CF_ACCESS_CLIENT_ID');
const accessClientSecret = required('COOLIFY_CF_ACCESS_CLIENT_SECRET');

if (webhook.protocol !== 'https:') throw new Error('Coolify webhook must use HTTPS.');
if (!/^[0-9a-f]{40}$/.test(sourceSha)) throw new Error('NIBLEAF_SOURCE_SHA must be a full lowercase Git SHA.');
if (!/^sha-[0-9a-f]{40}$/.test(rollbackTag)) throw new Error('Rollback image tag must be immutable: sha-<40 hex>.');
if (!['none', 'expand-contract'].includes(migrationMode)) throw new Error('Automatic deployment permits only none or expand-contract migrations.');
if (backupReference.length < 8 || migrationEvidence.length < 8) throw new Error('Backup and migration evidence references must be specific.');

const applicationUuid = webhook.searchParams.get('uuid');
const deployIndex = webhook.pathname.lastIndexOf('/deploy');
if (!applicationUuid || deployIndex < 0) throw new Error('Coolify webhook must identify one application UUID.');
const apiBase = new URL(webhook.href);
apiBase.pathname = webhook.pathname.slice(0, deployIndex);
apiBase.search = '';
apiBase.hash = '';

const targetTag = `sha-${sourceSha}`;
if (targetTag === rollbackTag) throw new Error('Candidate and rollback image tags are identical; there is no release to deploy.');
const headers = {
  accept: 'application/json',
  authorization: `Bearer ${token}`,
  'cf-access-client-id': accessClientId,
  'cf-access-client-secret': accessClientSecret,
};

const api = async (path, init = {}) => {
  const response = await fetch(new URL(`${apiBase.pathname}${path}`, apiBase), {
    ...init,
    headers: { ...headers, ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers },
    // Never forward provider credentials across a redirect. Cloudflare Access
    // service-token requests and Coolify API endpoints must answer directly.
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Coolify API ${path} returned HTTP ${response.status}: ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Coolify API ${path} did not return JSON.`);
  }
};

const updateImageTag = (value) =>
  api(`/applications/${applicationUuid}/envs`, {
    method: 'PATCH',
    body: JSON.stringify({ key: 'NIBLEAF_IMAGE_TAG', value, is_preview: false, is_literal: true }),
  });

const trigger = async () => {
  const response = await fetch(webhook, { method: 'POST', headers, redirect: 'error', signal: AbortSignal.timeout(30_000) });
  const text = await response.text();
  if (!response.ok) throw new Error(`Coolify deploy webhook returned HTTP ${response.status}: ${text.slice(0, 300)}`);
  const data = JSON.parse(text);
  const uuid = data.deployments?.[0]?.deployment_uuid ?? data.deployment_uuid;
  if (typeof uuid !== 'string' || !uuid) throw new Error('Coolify did not return a deployment UUID.');
  return uuid;
};

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const waitForDeployment = async (uuid) => {
  const deadline = Date.now() + 30 * 60_000;
  while (Date.now() < deadline) {
    const deployment = await api(`/deployments/${uuid}`);
    const status = deployment.status;
    process.stdout.write(`Coolify deployment ${uuid}: ${status}\n`);
    if (status === 'finished') return;
    if (status === 'failed' || status === 'cancelled-by-user') throw new Error(`Coolify deployment ${uuid} ended with ${status}.`);
    if (status !== 'queued' && status !== 'in_progress') throw new Error(`Coolify deployment ${uuid} returned unknown status ${String(status)}.`);
    await sleep(15_000);
  }
  throw new Error(`Timed out waiting for Coolify deployment ${uuid}.`);
};

const verifyProduction = async (expectedRevision, allowMissingRevision = false) => {
  let lastError;
  let consecutiveSuccesses = 0;
  for (let round = 1; round <= 12; round++) {
    try {
      await Promise.all(publicTargets.map((target) => verifyTarget(target, expectedRevision, allowMissingRevision)));
      consecutiveSuccesses++;
      if (consecutiveSuccesses >= 3) return;
    } catch (error) {
      consecutiveSuccesses = 0;
      lastError = error;
      process.stdout.write(`Production proof round ${round}/12 failed: ${error instanceof Error ? error.message : String(error)}\n`);
    }
    await sleep(10_000);
  }
  throw lastError ?? new Error('Production proof failed.');
};

const summary = async (lines) => {
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
};

const envs = await api(`/applications/${applicationUuid}/envs`);
const imageTagEnv = Array.isArray(envs) ? envs.find((entry) => entry.key === 'NIBLEAF_IMAGE_TAG' && !entry.is_preview) : undefined;
const currentTag = imageTagEnv?.real_value ?? imageTagEnv?.value;
if (currentTag !== rollbackTag) {
  throw new Error(
    `Provider NIBLEAF_IMAGE_TAG is ${currentTag ?? 'missing'}; expected rollback tag ${rollbackTag}. Refusing to replace unknown production state.`,
  );
}

let deploymentUuid;
let providerMutated = false;
try {
  await updateImageTag(targetTag);
  providerMutated = true;
  deploymentUuid = await trigger();
  await waitForDeployment(deploymentUuid);
  await verifyProduction(sourceSha);
} catch (releaseError) {
  if (!providerMutated) throw releaseError;
  process.stderr.write(`Release failed; restoring provider image tag ${rollbackTag}.\n`);
  try {
    await updateImageTag(rollbackTag);
    const rollbackUuid = await trigger();
    await waitForDeployment(rollbackUuid);
    // The first release through this contract may roll back to an older image
    // that predates revision headers. The provider's immutable tag plus a
    // completed rollback proves source in that bootstrap case; all routes must
    // still pass three consecutive HTTP/readiness rounds.
    await verifyProduction(rollbackTag.slice(4), true);
    await summary([
      '### Coolify compensation',
      `- Failed release: \`${deploymentUuid ?? 'not-started'}\``,
      `- Rollback: \`${rollbackUuid}\``,
      `- Restored image: \`${rollbackTag}\``,
      '- Production probes: **passed after rollback**',
    ]);
  } catch (rollbackError) {
    throw new AggregateError([releaseError, rollbackError], 'Release and automatic compensation both failed; production needs operator recovery.');
  }
  throw releaseError;
}

await summary([
  '### Coolify deployment',
  `- UUID: \`${deploymentUuid}\``,
  `- Source revision: \`${sourceSha}\``,
  `- Image tag: \`${targetTag}\``,
  `- Migration mode: \`${migrationMode}\``,
  `- Migration evidence: \`${migrationEvidence}\``,
  `- Backup/restore evidence: \`${backupReference}\``,
  '- App, API readiness, admin, docs, and both sitemaps: **200 on exact revision**',
  '- Availability claim: **replacement deployment verified; zero downtime not claimed**',
]);
