import { type Prisma, prisma } from '@nibleaf/database';
import { MemberRole } from '@nibleaf/shared/constants';
import { slugify } from '@nibleaf/shared/utils';
import type { CreateProjectBody, ProjectConfig, UpdateProjectBody } from '@nibleaf/validators';
import { conflict, notFound } from '@/errors';

const MAX_PROJECT_SLUG_LENGTH = 63;

/** Throw unless the project exists and belongs to the organization. Returns it. */
export const assertProjectInOrg = async (organizationId: string, projectId: string) => {
  const project = await prisma.project.findFirst({ where: { id: projectId, organizationId } });
  if (!project) {
    throw notFound('project', { id: projectId });
  }
  return project;
};

/**
 * Resolve a project's own organization and the user's role in it. Because each
 * site owns its org (1:1), this IS the per-site access check: membership in the
 * project's org = access to the site. Throws notFound (not forbidden) for
 * non-members so we never leak that a site exists.
 */
export const assertProjectAccess = async (userId: string, projectId: string) => {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    throw notFound('project', { id: projectId });
  }
  const member = await prisma.member.findUnique({
    where: { organizationId_userId: { organizationId: project.organizationId, userId } },
    select: { role: true },
  });
  if (!member) {
    throw notFound('project', { id: projectId });
  }
  return { project, organizationId: project.organizationId, role: member.role as MemberRole };
};

const candidateSlug = (base: string, index: number) => {
  if (index === 0) {
    return base.slice(0, MAX_PROJECT_SLUG_LENGTH).replace(/-+$/g, '') || 'docs';
  }
  const suffix = `-${index + 1}`;
  return `${base.slice(0, MAX_PROJECT_SLUG_LENGTH - suffix.length).replace(/-+$/g, '') || 'docs'}${suffix}`;
};

const uniqueProjectSlug = async (desired: string) => {
  const base = slugify(desired) || 'docs';
  for (let i = 0; i < 100; i++) {
    const candidate = candidateSlug(base, i);
    const existing = await prisma.project.findFirst({ where: { slug: candidate }, select: { id: true } });
    if (!existing) {
      return candidate;
    }
  }
  const suffix = `-${Date.now().toString(36)}`;
  return `${base.slice(0, MAX_PROJECT_SLUG_LENGTH - suffix.length).replace(/-+$/g, '') || 'docs'}${suffix}`;
};

/** List every site the user can reach — i.e. across all the orgs they belong to. */
export const listProjects = async (userId: string) => {
  const memberships = await prisma.member.findMany({ where: { userId }, select: { organizationId: true } });
  const organizationIds = memberships.map((m) => m.organizationId);
  return prisma.project.findMany({
    where: { organizationId: { in: organizationIds } },
    orderBy: { updatedAt: 'desc' },
    include: { _count: { select: { pages: true, deployments: true } } },
  });
};

export const createProject = async (userId: string, body: CreateProjectBody) => {
  const slug = await uniqueProjectSlug(body.name);
  return prisma.$transaction(async (tx) => {
    // Each site is its own workspace: mint a dedicated organization and make the
    // creator its owner. That org is the site's member boundary (per-site
    // members/roles). Slug is left null to avoid the global org-slug unique.
    const org = await tx.organization.create({ data: { name: body.name } });
    await tx.member.create({ data: { organizationId: org.id, userId, role: MemberRole.OWNER } });
    const project = await tx.project.create({
      data: {
        organizationId: org.id,
        name: body.name,
        slug,
        ...(body.description ? { description: body.description } : {}),
        ...(body.icon ? { icon: body.icon } : {}),
      },
    });
    // Every project starts with a single default language that owns its page tree.
    await tx.language.create({
      data: { projectId: project.id, code: 'en', label: 'English', direction: 'LTR', isDefault: true, position: 0 },
    });
    await tx.branch.create({ data: { projectId: project.id, name: 'main', isDefault: true } });
    return project;
  });
};

export const getProject = async (organizationId: string, id: string) => {
  const project = await prisma.project.findFirst({
    where: { id, organizationId },
    include: {
      _count: { select: { pages: true, deployments: true, domains: true } },
      languages: { orderBy: [{ position: 'asc' }], include: { projectTranslations: { where: { projectId: id }, take: 1 } } },
    },
  });
  if (!project) {
    throw notFound('project', { id });
  }
  return {
    ...project,
    languages: project.languages.map(({ projectTranslations, ...language }) => ({
      ...language,
      translation: projectTranslations[0] ?? null,
    })),
  };
};

/** Deep-merge an incoming config patch into the existing config, section by section.
 *  Object sections are merged one level deep; arrays (redirects/variables) replace. */
const mergeConfig = (existing: ProjectConfig, incoming: ProjectConfig): ProjectConfig => {
  const merged: Record<string, unknown> = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    if (Array.isArray(value)) {
      merged[key] = value;
    } else if (value && typeof value === 'object') {
      const prev = merged[key];
      merged[key] = { ...(prev && typeof prev === 'object' && !Array.isArray(prev) ? prev : {}), ...value };
    } else {
      merged[key] = value;
    }
  }
  return merged as ProjectConfig;
};

export const updateProject = async (organizationId: string, id: string, body: UpdateProjectBody) => {
  const project = await assertProjectInOrg(organizationId, id);
  if (body.slug !== undefined && body.slug !== project.slug) {
    const existing = await prisma.project.findFirst({ where: { slug: body.slug, id: { not: id } }, select: { id: true } });
    if (existing) {
      throw conflict('That deployment name is already in use.', { slug: body.slug });
    }
  }

  let configData: Prisma.InputJsonValue | undefined;
  if (body.config !== undefined) {
    const existing = (project.config as ProjectConfig | null) ?? {};
    const merged = mergeConfig(existing, body.config);
    configData = merged as Prisma.InputJsonValue;
  }

  return prisma.project.update({
    where: { id },
    data: {
      ...(body.name === undefined ? {} : { name: body.name }),
      ...(body.slug === undefined ? {} : { slug: body.slug }),
      ...(body.description === undefined ? {} : { description: body.description }),
      ...(body.icon === undefined ? {} : { icon: body.icon }),
      ...(configData === undefined ? {} : { config: configData }),
    },
  });
};

export const deleteProject = async (organizationId: string, id: string) => {
  await assertProjectInOrg(organizationId, id);
  // Each site owns its organization (1:1), so deleting the site deletes its org —
  // which cascades the project itself plus its members and pending invitations.
  await prisma.organization.delete({ where: { id: organizationId } });
  return { id };
};
