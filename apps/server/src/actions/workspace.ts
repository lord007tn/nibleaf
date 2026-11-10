import { prisma } from '@nibleaf/database';
import { MemberRole } from '@nibleaf/shared/constants';
import { roleAtLeast } from '@nibleaf/shared/rbac';
import type { UpdateWorkspaceSettingsBody } from '@nibleaf/validators';
import { z } from 'zod';
import { forbidden, notFound } from '@/errors';
import { resolveOrgAccess } from '@/lib/access';
import { getGitWebhookSecret } from './git-webhook-secret';
import { readProjectGitSettings, writeProjectSettings } from './project-settings-storage';

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

/** Compatibility workspace endpoints may resolve a sole website only. */
const settingsProject = async (organizationId: string, projectId?: string) => {
  const projects = await prisma.project.findMany({
    where: { organizationId, ...(projectId ? { id: projectId } : {}) },
    take: 2,
    select: { id: true },
  });
  if (projects.length !== 1 || !projects[0]) throw notFound('project');
  return projects[0].id;
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

/** Allowlisted organization fields plus THIS website's settings only. */
export const getScopedWorkspaceSettings = async (organizationId: string, role: string, projectId?: string) => {
  const id = await settingsProject(organizationId, projectId);
  const [org, projectCount, memberCount, storedGit, legacy] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: organizationId } }),
    prisma.project.count({ where: { organizationId } }),
    prisma.member.count({ where: { organizationId } }),
    readProjectGitSettings(id),
    prisma.projectLegacySettings.findUnique({ where: { projectId: id }, select: { metadata: true } }),
  ]);
  const metadata = parseWorkspaceMetadata(org.metadata);
  const parsedGit = z.record(z.string(), z.unknown()).safeParse(storedGit);
  const git = parsedGit.success ? { ...parsedGit.data } : {};
  delete git.webhookSecret;
  if (!roleAtLeast(role, MemberRole.ADMIN)) {
    for (const field of ['cloneUrl', 'instanceUrl'] as const) {
      if (!(field in git)) continue;
      const clean = withoutUrlCredentials(git[field]);
      if (clean === null) delete git[field];
      else git[field] = clean;
    }
  } else {
    const secret = await getGitWebhookSecret(id);
    if (secret) git.webhookSecret = secret;
  }
  return {
    plan: metadata.plan,
    notifications: metadata.notifications,
    integrations: roleAtLeast(role, MemberRole.ADMIN) ? ((legacy?.metadata as Record<string, unknown> | undefined)?.integrations ?? {}) : {},
    git,
    name: org.name,
    slug: org.slug,
    projectCount,
    memberCount,
  };
};

/** `metadata.git` fields only the server writes (import/sync bookkeeping). A
 *  settings PATCH replaces `git` wholesale with the validated client shape —
 *  which cannot contain these (gitConfigSchema strips them) — so carry them
 *  over instead of silently wiping them on every save. The webhook secret is
 *  not a metadata field (see ./git-webhook-secret). */
const SERVER_MANAGED_GIT_FIELDS = ['lastImportedAt', 'lastSyncAt', 'lastSyncStatus', 'lastSyncError'] as const;

/** Settings that belong to the organization, not the website (§3, §4.1). */
const ORGANIZATION_FIELDS = ['plan', 'notifications'] as const;

export const updateWorkspaceSettings = async (organizationId: string, actorId: string, patch: UpdateWorkspaceSettingsBody, projectId?: string) => {
  // The routes are guarded by the website Admin role; org fields need the org
  // Owner/Admin role. Checked before any write so a refused patch changes nothing.
  if (ORGANIZATION_FIELDS.some((field) => patch[field] !== undefined)) {
    const { orgRole } = await resolveOrgAccess(actorId, organizationId);
    if (!roleAtLeast(orgRole, MemberRole.ADMIN))
      throw forbidden('Organization administrator access required to change the plan or notification defaults.');
  }
  const id = await settingsProject(organizationId, projectId);
  await writeProjectSettings(id, ({ git, legacy }) => {
    const nextGit: Record<string, unknown> = patch.git ? { ...patch.git } : { ...git };
    for (const field of SERVER_MANAGED_GIT_FIELDS) {
      if (nextGit[field] === undefined && git[field] !== undefined) nextGit[field] = git[field];
    }
    return { git: nextGit, legacy: { ...legacy, ...(patch.integrations ? { integrations: patch.integrations } : {}) } };
  });
  // Genuine org settings stay on the org. Do not copy unknown/site fields back.
  if (patch.plan !== undefined || patch.notifications !== undefined) {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM organization WHERE id = ${organizationId} FOR NO KEY UPDATE`;
      const org = await tx.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { metadata: true } });
      const current = parseWorkspaceMetadata(org.metadata);
      await tx.organization.update({
        where: { id: organizationId },
        data: {
          metadata: JSON.stringify({
            ...current,
            ...(patch.plan !== undefined ? { plan: patch.plan } : {}),
            ...(patch.notifications !== undefined ? { notifications: patch.notifications } : {}),
          }),
        },
      });
    });
  }
};
