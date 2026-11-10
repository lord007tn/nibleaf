import { joinLinkCreatorAuthorizes } from '@nibleaf/auth/join-links';
import { prisma } from '@nibleaf/database';
import { hashJoinLinkToken } from '@nibleaf/shared/crypto';
import { isJoinLinkToken, joinLinkStatus } from '@nibleaf/shared/join-links';
import type { CreateJoinLinkBody } from '@nibleaf/validators';
import { notFound } from '@/errors';
import { admit, invalidJoinLink } from './admissions';
import { changeOrganizationJoinLink, createOrganizationJoinLink, deleteOrganizationJoinLink, listOrganizationJoinLinks } from './organizations';

const soleProject = async (organizationId: string, projectId?: string) => {
  const projects = await prisma.project.findMany({
    where: { organizationId, ...(projectId ? { id: projectId } : {}) },
    select: { id: true },
    take: 2,
  });
  if (projects.length !== 1 || !projects[0]) throw notFound('project');
  return projects[0].id;
};
export const listJoinLinks = async (organizationId: string, projectId?: string) =>
  listOrganizationJoinLinks(organizationId, await soleProject(organizationId, projectId));
export const createJoinLink = async (organizationId: string, actor: { id: string; role: string }, body: CreateJoinLinkBody, siteId?: string) => {
  const projectId = await soleProject(organizationId, siteId);
  return createOrganizationJoinLink(organizationId, actor.id, { ...body, grants: [{ projectId, role: body.role }] }, projectId);
};
export const revokeJoinLink = async (organizationId: string, id: string, actor: { id: string; role: string }, siteId?: string) =>
  (await changeOrganizationJoinLink(organizationId, actor.id, id, false, await soleProject(organizationId, siteId))).link;
export const regenerateJoinLink = async (organizationId: string, id: string, actor: { id: string; role: string }, siteId?: string) =>
  changeOrganizationJoinLink(organizationId, actor.id, id, true, await soleProject(organizationId, siteId));
export const getJoinLinkPreview = async (token: string) => {
  if (!isJoinLinkToken(token)) throw invalidJoinLink();
  const link = await prisma.joinLink.findUnique({
    where: { tokenHash: hashJoinLinkToken(token) },
    include: {
      organization: { select: { name: true, logo: true, needsRepair: true, deletionStartedAt: true } },
      createdBy: { select: { name: true } },
      grants: { select: { role: true, project: { select: { id: true, name: true } } } },
    },
  });
  if (
    !link ||
    link.organization.needsRepair ||
    link.organization.deletionStartedAt ||
    joinLinkStatus(link) !== 'active' ||
    !(await joinLinkCreatorAuthorizes(prisma, link))
  )
    throw invalidJoinLink();
  return {
    organizationId: link.organizationId,
    organizationName: link.organization.name,
    organizationLogo: link.organization.logo,
    inviterName: link.createdBy?.name || null,
    siteName: link.grants.length === 1 ? (link.grants[0]?.project.name ?? link.organization.name) : link.organization.name,
    role: link.grants[0]?.role ?? 'viewer',
    grants: link.grants.map((g) => ({ projectId: g.project.id, name: g.project.name, role: g.role })),
    allowedDomain: link.allowedDomain,
  };
};
export const joinWithLink = (token: string, userId: string) => admit(userId, { token });
export const deleteJoinLink = async (organizationId: string, id: string, actor: { id: string; role: string }, siteId?: string) =>
  deleteOrganizationJoinLink(organizationId, actor.id, id, await soleProject(organizationId, siteId));
