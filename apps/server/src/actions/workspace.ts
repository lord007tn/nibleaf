import { prisma } from '@nibleaf/database';
import { logger } from '@nibleaf/logger';
import { MemberRole } from '@nibleaf/shared/constants';
import { roleAtLeast } from '@nibleaf/shared/rbac';
import type { UpdateWorkspaceSettingsBody } from '@nibleaf/validators';
import { z } from 'zod';
import { notFound } from '@/errors';
import { getGitWebhookSecret, moveLegacyWebhookSecret, readGitWebhookSecret, settleLegacyWebhookSecretIn } from './git-webhook-secret';

interface WorkspaceMetadata {
  plan: string;
  notifications: Record<string, boolean>;
  integrations: Record<string, unknown>;
  git: Record<string, unknown>;
  [key: string]: unknown;
}

const defaults = (): WorkspaceMetadata => ({ plan: 'free', notifications: {}, integrations: {}, git: {} });

export const parseWorkspaceMetadata = (raw: string | null): WorkspaceMetadata => {
  if (!raw) {
    return defaults();
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return { ...defaults(), ...parsed };
  } catch {
    return defaults();
  }
};

const getWorkspaceSettings = async (organizationId: string) => {
  const org = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!org) {
    throw notFound('organization', { id: organizationId });
  }
  const [projectCount, memberCount] = await Promise.all([
    prisma.project.count({ where: { organizationId } }),
    prisma.member.count({ where: { organizationId } }),
  ]);
  return {
    ...parseWorkspaceMetadata(org.metadata),
    name: org.name,
    slug: org.slug,
    projectCount,
    memberCount,
  };
};

/** An http(s) URL without credentials, query or fragment; null when it can't be
 *  parsed. Mirrors the auth package's organization-response redaction. */
const withoutUrlCredentials = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
};

/** Logs only the error code: a database error message can echo query arguments. */
const logMoveFailure = (organizationId: string, error: unknown): void => {
  logger.warn(
    { organizationId, code: (error as { code?: unknown } | null)?.code },
    'Could not move the Git webhook secret out of organization metadata.',
  );
};

/**
 * The settings DTO shared by every workspace and site settings response. Only
 * known sections are returned, to every role down to Viewer. The webhook secret is read from server-only
 * storage and included for ADMIN and above. A copy found in metadata is never
 * returned, and it is moved to server-only storage on any member's read. A
 * failed move is logged and never fails the read.
 */
export const getScopedWorkspaceSettings = async (organizationId: string, role: string) => {
  const settings = await getWorkspaceSettings(organizationId);
  const parsedGit = z.record(z.string(), z.unknown()).safeParse(settings.git);
  const git = parsedGit.success ? { ...parsedGit.data } : {};
  if ('webhookSecret' in git) {
    delete git.webhookSecret;
    await settleLegacyWebhookSecretIn(organizationId, settings.git).catch((error: unknown) => logMoveFailure(organizationId, error));
  }
  if (!roleAtLeast(role, MemberRole.ADMIN)) {
    // Legacy rows may hold credentials inside the stored Git URLs. Only Admins,
    // who can fix them, see the stored value.
    for (const field of ['cloneUrl', 'instanceUrl'] as const) {
      if (!(field in git)) continue;
      const clean = withoutUrlCredentials(git[field]);
      if (clean === null) delete git[field];
      else git[field] = clean;
    }
  }
  if (roleAtLeast(role, MemberRole.ADMIN)) {
    const webhookSecret = await getGitWebhookSecret(organizationId).catch(async (error: unknown) => {
      logMoveFailure(organizationId, error);
      return (await readGitWebhookSecret(organizationId)).secret;
    });
    if (webhookSecret) git.webhookSecret = webhookSecret;
  }
  return {
    plan: settings.plan,
    notifications: settings.notifications,
    // The legacy `integrations` blob may hold webhook URLs: admin material, like
    // the webhook secret. Editors and Viewers get every other section read-only.
    integrations: roleAtLeast(role, MemberRole.ADMIN) ? settings.integrations : {},
    git,
    name: settings.name,
    slug: settings.slug,
    projectCount: settings.projectCount,
    memberCount: settings.memberCount,
  };
};

/** `metadata.git` fields only the server writes (import/sync bookkeeping). A
 *  settings PATCH replaces `git` wholesale with the validated client shape —
 *  which cannot contain these (gitConfigSchema strips them) — so carry them
 *  over instead of silently wiping them on every save. The webhook secret is
 *  not a metadata field (see ./git-webhook-secret). */
const SERVER_MANAGED_GIT_FIELDS = ['lastImportedAt', 'lastSyncAt', 'lastSyncStatus', 'lastSyncError'] as const;

export const updateWorkspaceSettings = async (organizationId: string, patch: UpdateWorkspaceSettingsBody) => {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { metadata: true } });
  if (!org) {
    throw notFound('organization', { id: organizationId });
  }
  const current = parseWorkspaceMetadata(org.metadata);
  await moveLegacyWebhookSecret(organizationId, current);
  const merged = { ...current, ...patch };
  if (patch.git) {
    const previousGit = (current.git ?? {}) as Record<string, unknown>;
    const nextGit: Record<string, unknown> = { ...patch.git };
    for (const field of SERVER_MANAGED_GIT_FIELDS) {
      if (nextGit[field] === undefined && previousGit[field] !== undefined) {
        nextGit[field] = previousGit[field];
      }
    }
    merged.git = nextGit;
  }
  await prisma.organization.update({ where: { id: organizationId }, data: { metadata: JSON.stringify(merged) } });
};
