import { prisma } from '@nibleaf/database';
import type { UpdateWorkspaceSettingsBody } from '@nibleaf/validators';
import { notFound } from '@/errors';

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

export const getWorkspaceSettings = async (organizationId: string) => {
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

/** `metadata.git` fields only the server writes (webhook secret, import/sync
 *  bookkeeping). A settings PATCH replaces `git` wholesale with the validated
 *  client shape — which cannot contain these (gitConfigSchema strips them) —
 *  so carry them over instead of silently wiping them on every save. */
const SERVER_MANAGED_GIT_FIELDS = ['webhookSecret', 'lastImportedAt', 'lastSyncAt', 'lastSyncStatus', 'lastSyncError'] as const;

export const updateWorkspaceSettings = async (organizationId: string, patch: UpdateWorkspaceSettingsBody) => {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { metadata: true } });
  if (!org) {
    throw notFound('organization', { id: organizationId });
  }
  const current = parseWorkspaceMetadata(org.metadata);
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
  return getWorkspaceSettings(organizationId);
};
