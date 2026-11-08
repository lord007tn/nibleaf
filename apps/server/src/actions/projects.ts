import { eraseProjectOrganization, TenantErasureProjectNotFoundError, TenantUsageDeletionPendingError } from '@nibleaf/auth/tenant-erasure';
import { assignDefaultUsagePlan, Prisma, prisma } from '@nibleaf/database';
import { addonDefinitions, defaultProjectAddonProvisioning, projectConfigWithAddons } from '@nibleaf/shared/addons';
import { MemberRole } from '@nibleaf/shared/constants';
import { THEME_PRESETS, THEME_SCHEMA_VERSION } from '@nibleaf/shared/themes';
import { slugify } from '@nibleaf/shared/utils';
import type { CreateProjectBody, ProjectConfigUpdate, UpdateProjectBody } from '@nibleaf/validators';
import { conflict, notFound } from '@/errors';
import { mutateProjectConfig } from './project-config';

const MAX_PROJECT_SLUG_LENGTH = 63;
const isPlainObject = (value: unknown): value is Record<string, unknown> => Object.prototype.toString.call(value) === '[object Object]';

/** Every new site starts on the curated default preset instead of the legacy
 *  accent-only palette: storing a versioned `theme` object opts the project
 *  into the theme resolver (no legacy branch in the reader). Existing projects
 *  without a `theme` keep their palette. Mirrors `createStarterProject` in
 *  @nibleaf/auth, which seeds the sign-up starter site the same way. */
const starterThemeConfig = () => ({ version: THEME_SCHEMA_VERSION, preset: 'harbor' as const, metadata: THEME_PRESETS.harbor.metadata });

/** What "pages" means wherever a site's page count is shown (workspace
 *  overview, sites list, MCP): content pages — not navigation groups — on the
 *  default branch, across all languages. The same set the Site Overview counts. */
const contentPagesWhere: Prisma.PageWhereInput = { kind: 'PAGE', branch: { isDefault: true } };

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

/** The commit message `publishStarterSite` (@nibleaf/auth) gives the sign-up
 *  starter site's automatic first publish (always version 1). */
const STARTER_PUBLISH_MESSAGE = 'Publish starter site';

/** Every publish on a site, by any member, except the starter site's automatic
 *  version 1. `not` skips NULLs in SQL, hence the explicit `null` branch. */
const nonStarterPublishWhere: Prisma.DeploymentWhereInput = {
  OR: [{ version: { not: 1 } }, { commitMessage: null }, { commitMessage: { not: STARTER_PUBLISH_MESSAGE } }],
};

/** List every site the user can reach — i.e. across all the orgs they belong to.
 *  Each site also says how many publishes on it went live (`livePublishes`: any
 *  member's, the sign-up starter publish excluded)
 *  and whether one is queued or running now (`publishing`), so the dashboard's
 *  first-run checklist is decided by this one request for any number of sites.
 *  `live`/`lastPublishedAt` describe what readers can open now (starter included),
 *  for the site status shown on the overview and the sites list. */
export const listProjects = async (userId: string) => {
  const memberships = await prisma.member.findMany({ where: { userId }, select: { organizationId: true } });
  const organizationIds = memberships.map((m) => m.organizationId);
  const projects = await prisma.project.findMany({
    where: { organizationId: { in: organizationIds } },
    orderBy: { updatedAt: 'desc' },
    include: { _count: { select: { pages: { where: contentPagesWhere }, deployments: true } } },
  });
  const projectIds = projects.map((project) => project.id);
  const [activity, newestLive] =
    projects.length === 0
      ? [[], []]
      : await Promise.all([
          prisma.deployment.groupBy({
            by: ['projectId', 'status'],
            where: {
              projectId: { in: projectIds },
              OR: [
                // Live publishes count the user's own, not the sign-up starter's automatic one...
                { status: 'READY', ...nonStarterPublishWhere },
                // ...but any publish in flight, the starter's included, is "Publishing…".
                { status: { in: ['PENDING', 'BUILDING'] } },
              ],
            },
            _count: { _all: true },
          }),
          // Readers see the highest READY version (the starter publish included).
          prisma.deployment.groupBy({ by: ['projectId'], where: { projectId: { in: projectIds }, status: 'READY' }, _max: { version: true } }),
        ]);
  const liveVersions = newestLive.flatMap((row) => (row._max.version === null ? [] : [{ projectId: row.projectId, version: row._max.version }]));
  // One bounded read for those versions' own timestamps; independent maxima could mix two versions.
  const liveRows =
    liveVersions.length === 0
      ? []
      : await prisma.deployment.findMany({ where: { OR: liveVersions }, select: { projectId: true, completedAt: true, createdAt: true } });
  return projects.map((project) => {
    const rows = activity.filter((row) => row.projectId === project.id);
    const live = liveRows.find((row) => row.projectId === project.id);
    return {
      ...project,
      livePublishes: rows.filter((row) => row.status === 'READY').reduce((sum, row) => sum + row._count._all, 0),
      publishing: rows.some((row) => row.status !== 'READY' && row._count._all > 0),
      /** The site has a published version readers can open (the starter publish counts). */
      live: Boolean(live),
      /** When the version readers see went live; null before the first publish. */
      lastPublishedAt: live ? (live.completedAt ?? live.createdAt) : null,
    };
  });
};

export const createProject = async (userId: string, body: CreateProjectBody) => {
  const slug = await uniqueProjectSlug(body.name);
  return prisma.$transaction(async (tx) => {
    // Each site is its own workspace: mint a dedicated organization and make the
    // creator its owner. That org is the site's member boundary (per-site
    // members/roles). Slug is left null to avoid the global org-slug unique.
    const org = await tx.organization.create({ data: { name: body.name } });
    await assignDefaultUsagePlan(tx, org.id);
    await tx.member.create({ data: { organizationId: org.id, userId, role: MemberRole.OWNER } });
    const project = await tx.project.create({
      data: {
        organizationId: org.id,
        name: body.name,
        slug,
        ...(body.description ? { description: body.description } : {}),
        ...(body.icon ? { icon: body.icon } : {}),
        config: projectConfigWithAddons(
          { theme: starterThemeConfig() },
          addonDefinitions.map((definition) => ({ key: definition.id, enabled: definition.defaultEnabled, config: definition.defaultConfig })),
        ) as Prisma.InputJsonValue,
      },
    });
    const defaultAddons = defaultProjectAddonProvisioning(project.id, userId);
    await tx.projectAddon.createMany({
      data: defaultAddons.addons.map((addon) => ({ ...addon, config: addon.config as Prisma.InputJsonValue })),
    });
    await tx.projectAddonAuditEvent.createMany({
      data: defaultAddons.auditEvents.map((event) => ({ ...event, nextConfig: event.nextConfig as Prisma.InputJsonValue })),
    });
    // Every project starts with a single default language that owns its page tree.
    await tx.language.create({
      data: { projectId: project.id, code: 'en', label: 'English', direction: 'LTR', isDefault: true, position: 0 },
    });
    await tx.branch.create({ data: { projectId: project.id, name: 'main', isDefault: true }, select: { id: true } });
    return project;
  });
};

/**
 * One site, with `hasPublishedVersion`: whether a publish went live and kept
 * its site copy — exactly what an export copies (see `createPublishedSnapshot`
 * in ./exports), the sign-up starter's first publish included. Unlike the
 * deployments list (newest 50), this isn't capped by history.
 */
export const getProject = async (organizationId: string, id: string) => {
  const [project, published] = await Promise.all([
    prisma.project.findFirst({
      where: { id, organizationId },
      include: {
        _count: { select: { pages: { where: contentPagesWhere }, deployments: true, domains: true } },
        languages: { orderBy: [{ position: 'asc' }], include: { projectTranslations: { where: { projectId: id }, take: 1 } } },
      },
    }),
    prisma.deployment.findFirst({ where: { projectId: id, status: 'READY', snapshot: { not: Prisma.DbNull } }, select: { id: true } }),
  ]);
  if (!project) {
    throw notFound('project', { id });
  }
  return {
    ...project,
    hasPublishedVersion: published !== null,
    languages: project.languages.map(({ projectTranslations, ...language }) => ({
      ...language,
      translation: projectTranslations[0] ?? null,
    })),
  };
};

/** Deep-merge an incoming config patch into the existing config, section by section.
 *  Object sections are merged one level deep; arrays (redirects/variables) replace. */
const mergeConfig = (existing: Record<string, unknown>, incoming: ProjectConfigUpdate): Record<string, unknown> => {
  const merged: Record<string, unknown> = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    if (Array.isArray(value)) {
      merged[key] = value;
    } else if (isPlainObject(value)) {
      const prev = merged[key];
      merged[key] = { ...(isPlainObject(prev) ? prev : {}), ...value };
    } else {
      merged[key] = value;
    }
  }
  return merged;
};

export const updateProject = async (organizationId: string, id: string, body: UpdateProjectBody) => {
  const project = await assertProjectInOrg(organizationId, id);
  if (body.slug !== undefined && body.slug !== project.slug) {
    const existing = await prisma.project.findFirst({ where: { slug: body.slug, id: { not: id } }, select: { id: true } });
    if (existing) {
      throw conflict('That deployment name is already in use.', { slug: body.slug });
    }
  }

  const projectData = {
    ...(body.name === undefined ? {} : { name: body.name }),
    ...(body.slug === undefined ? {} : { slug: body.slug }),
    ...(body.description === undefined ? {} : { description: body.description }),
    ...(body.icon === undefined ? {} : { icon: body.icon }),
  };

  const config = body.config;
  if (config === undefined) {
    return prisma.project.update({ where: { id }, data: projectData });
  }

  return prisma.$transaction(async (tx) => {
    if (Object.keys(projectData).length > 0) {
      await tx.project.update({ where: { id }, data: projectData });
    }
    await mutateProjectConfig(tx, organizationId, id, (current) => mergeConfig(current, config));
    const updated = await tx.project.findFirst({ where: { id, organizationId } });
    if (!updated) throw notFound('project', { id });
    return updated;
  });
};

export const deleteProject = async (organizationId: string, id: string) => {
  await assertProjectInOrg(organizationId, id);
  try {
    await eraseProjectOrganization(organizationId, id);
  } catch (error) {
    if (error instanceof TenantUsageDeletionPendingError) {
      throw conflict('Usage ingestion is still draining. Retry project deletion.', { reason: 'usage_ingestion_pending' });
    }
    if (error instanceof TenantErasureProjectNotFoundError) throw notFound('project', { id });
    throw error;
  }
  return { id };
};
