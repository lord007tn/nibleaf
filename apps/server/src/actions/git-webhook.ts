import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createJob, QueueNames } from '@nibleaf/bullmq';
import type { PublishDeploymentJobData } from '@nibleaf/bullmq/jobs/publish';
import { Prisma, prisma } from '@nibleaf/database';
import { logger } from '@nibleaf/logger';
import { MemberRole } from '@nibleaf/shared/constants';
import type { GitConfigStored } from '@nibleaf/validators';
import { z } from 'zod';
import { badRequest } from '@/errors';
import { importFromGitProvider } from './git-import';
import { logPlatformEvent } from './platform-events';

/**
 * Push-to-deploy webhook (Mintlify-style, self-hosted flavour). Mintlify installs
 * a central GitHub App and redeploys docs on every push to the deployment branch;
 * a self-hosted instance has no central app, so the same process shape is a
 * standard repository webhook instead: the user adds our payload URL + a
 * per-project secret to their repo, and every verified push to the configured
 * branch re-runs the one-way import (and optionally auto-publishes).
 *
 * The secret and sync bookkeeping live in the org metadata `git` blob next to
 * the client-editable GitConfig (see GitConfigStored in @nibleaf/validators).
 */

/** 32 random bytes as hex — the shared webhook secret for one project's org. */
export const generateWebhookSecret = (): string => randomBytes(32).toString('hex');

/** Constant-time string equality (length mismatch short-circuits, which only
 *  leaks the length — not the content — of the expected value). */
const timingSafeEqualStrings = (a: string, b: string): boolean => {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
};

/**
 * Verify GitHub's `X-Hub-Signature-256` header: `sha256=` + HMAC-SHA256 of the
 * RAW request body keyed with the webhook secret, hex-encoded.
 */
export const verifyGitHubSignature = (rawBody: string, signatureHeader: string | undefined, secret: string): boolean => {
  if (!(secret && signatureHeader?.startsWith('sha256='))) {
    return false;
  }
  const provided = signatureHeader.slice('sha256='.length).trim().toLowerCase();
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  return timingSafeEqualStrings(provided, expected);
};

/** Verify GitLab's `X-Gitlab-Token` header: plain secret equality (compared in
 *  constant time all the same). */
export const verifyGitLabToken = (token: string | undefined, secret: string): boolean =>
  Boolean(secret && token) && timingSafeEqualStrings(token as string, secret);

/** Branch name from a push payload's `ref` (`refs/heads/main` → `main`), or null
 *  for tag pushes / non-push payloads. GitHub and GitLab share this field. */
export const extractPushBranch = (payload: unknown): string | null => {
  const parsed = z.object({ ref: z.string() }).safeParse(payload);
  if (!parsed.success || !parsed.data.ref.startsWith('refs/heads/')) {
    return null;
  }
  const branch = parsed.data.ref.slice('refs/heads/'.length);
  return branch.length > 0 ? branch : null;
};

const parseMetadata = (raw: string | null): Record<string, unknown> => {
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
};

/** The org's stored git config (client fields + server-managed webhook fields). */
export const getStoredGitConfig = async (organizationId: string): Promise<GitConfigStored> => {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { metadata: true } });
  return (parseMetadata(org?.metadata ?? null).git ?? {}) as GitConfigStored;
};

/** Read-modify-write one field set of `metadata.git`, preserving everything else. */
const patchStoredGitConfig = async (organizationId: string, patch: Partial<GitConfigStored>): Promise<void> => {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { metadata: true } });
  const metadata = parseMetadata(org?.metadata ?? null);
  const git = { ...((metadata.git ?? {}) as Record<string, unknown>), ...patch };
  // `undefined` values mean "remove the key" (JSON.stringify drops them).
  metadata.git = git;
  await prisma.organization.update({ where: { id: organizationId }, data: { metadata: JSON.stringify(metadata) } });
};

/** Generate (or rotate) the project's webhook secret. Admin-guarded at the route. */
export const rotateGitWebhookSecret = async (organizationId: string): Promise<string> => {
  const webhookSecret = generateWebhookSecret();
  await patchStoredGitConfig(organizationId, { webhookSecret });
  return webhookSecret;
};

const MAX_SYNC_ERROR_LENGTH = 300;
const MAX_VERSION_RETRIES = 5;

/**
 * Enqueue a publish after a successful webhook import, mirroring the dashboard
 * publish endpoint (PENDING deployment row + PUBLISH job) and the starter-site
 * auto-publish in packages/auth. Attributed to the org owner when one exists
 * (`createdById` is nullable, so a missing owner does not block). `auto: true`
 * keeps system publishes out of the activation funnel's manual-publish count.
 */
const enqueueWebhookPublish = async (organizationId: string, projectId: string, branch: string): Promise<void> => {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { takedownAt: true } });
  if (project?.takedownAt) {
    throw badRequest('This site has been taken down by the platform moderators and cannot be published.', { projectId });
  }
  const owner = await prisma.member.findFirst({
    where: { organizationId, role: MemberRole.OWNER },
    orderBy: { createdAt: 'asc' },
    select: { userId: true },
  });

  // max(version)+1 then create is a read-then-write race; the unique
  // (projectId, version) constraint turns collisions into P2002s we retry.
  let deploymentId: string | null = null;
  let version = 0;
  for (let attempt = 0; attempt < MAX_VERSION_RETRIES; attempt++) {
    const last = await prisma.deployment.aggregate({ where: { projectId }, _max: { version: true } });
    version = (last._max.version ?? 0) + 1;
    try {
      const deployment = await prisma.deployment.create({
        data: {
          projectId,
          version,
          status: 'PENDING',
          createdById: owner?.userId ?? null,
          commitMessage: `Sync from git push (${branch})`,
        },
      });
      deploymentId = deployment.id;
      break;
    } catch (error) {
      const isVersionConflict = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
      if (!isVersionConflict || attempt === MAX_VERSION_RETRIES - 1) {
        throw error;
      }
    }
  }
  if (!deploymentId) {
    return;
  }
  const jobData: PublishDeploymentJobData = { deploymentId, projectId, auto: true };
  await createJob(QueueNames.PUBLISH, { name: 'publish-deployment', data: jobData });
  logPlatformEvent('publish_clicked', { userId: owner?.userId ?? null, projectId, metadata: { auto: true, source: 'git-webhook', version } });
};

/**
 * The background half of the webhook: run the one-way import, record the sync
 * outcome on the git metadata, and auto-publish when enabled. The HTTP handler
 * answers 202 first and fires this without awaiting — errors land in the log
 * and in `lastSyncStatus`/`lastSyncError`, never in the webhook response.
 */
export const runGitWebhookSync = async (organizationId: string, projectId: string, branch: string): Promise<void> => {
  try {
    const summary = await importFromGitProvider(organizationId, projectId);
    // Re-read AFTER the import: importFromGitProvider rewrites metadata.git
    // (connected/lastImportedAt), so patching before it finishes would be lost.
    await patchStoredGitConfig(organizationId, {
      lastSyncAt: new Date().toISOString(),
      lastSyncStatus: 'ok',
      lastSyncError: undefined,
    });
    logger.info({ projectId, branch, ...summary }, 'git webhook sync imported');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Import failed.';
    await patchStoredGitConfig(organizationId, {
      lastSyncAt: new Date().toISOString(),
      lastSyncStatus: 'failed',
      lastSyncError: message.slice(0, MAX_SYNC_ERROR_LENGTH),
    }).catch(() => undefined);
    logger.warn({ error, projectId, branch }, 'git webhook sync failed');
    return;
  }

  const git = await getStoredGitConfig(organizationId);
  if (git.autoPublish === true) {
    try {
      await enqueueWebhookPublish(organizationId, projectId, branch);
    } catch (error) {
      // Content synced fine — a publish enqueue failure (redis down, takedown)
      // must not flip the sync status; the user can still publish manually.
      logger.warn({ error, projectId }, 'git webhook auto-publish failed; content was imported');
    }
  }
};
