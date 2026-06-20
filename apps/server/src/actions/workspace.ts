import { prisma } from '@plume/database';
import type { UpdateWorkspaceSettingsBody } from '@plume/validators';
import { notFound } from '@/errors';

interface WorkspaceMetadata {
  plan: string;
  notifications: Record<string, boolean>;
  integrations: Record<string, unknown>;
  git: Record<string, unknown>;
  [key: string]: unknown;
}

const defaults = (): WorkspaceMetadata => ({ plan: 'free', notifications: {}, integrations: {}, git: {} });

const parseMetadata = (raw: string | null): WorkspaceMetadata => {
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
    ...parseMetadata(org.metadata),
    name: org.name,
    slug: org.slug,
    projectCount,
    memberCount,
  };
};

export const updateWorkspaceSettings = async (organizationId: string, patch: UpdateWorkspaceSettingsBody) => {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { metadata: true } });
  if (!org) {
    throw notFound('organization', { id: organizationId });
  }
  const merged = { ...parseMetadata(org.metadata), ...patch };
  await prisma.organization.update({ where: { id: organizationId }, data: { metadata: JSON.stringify(merged) } });
  return getWorkspaceSettings(organizationId);
};
