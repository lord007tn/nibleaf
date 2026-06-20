import { Prisma, prisma } from '@plume/database';
import { slugify } from '@plume/shared/utils';
import type { CreateProjectBody, ProjectConfig, UpdateProjectBody } from '@plume/validators';
import { notFound } from '@/errors';

/** Find a slug unique within the organization, appending -2, -3, … on collision. */
const uniqueSlug = async (organizationId: string, name: string): Promise<string> => {
  const base = slugify(name) || 'docs';
  let slug = base;
  let suffix = 1;
  while (await prisma.project.findFirst({ where: { organizationId, slug }, select: { id: true } })) {
    suffix += 1;
    slug = `${base}-${suffix}`;
  }
  return slug;
};

/** Throw unless the project exists and belongs to the organization. Returns it. */
export const assertProjectInOrg = async (organizationId: string, projectId: string) => {
  const project = await prisma.project.findFirst({ where: { id: projectId, organizationId } });
  if (!project) {
    throw notFound('project', { id: projectId });
  }
  return project;
};

export const listProjects = (organizationId: string) =>
  prisma.project.findMany({
    where: { organizationId },
    orderBy: { updatedAt: 'desc' },
    include: { _count: { select: { pages: true, deployments: true } } },
  });

export const createProject = async (organizationId: string, body: CreateProjectBody) => {
  const slug = await uniqueSlug(organizationId, body.name);
  const project = await prisma.project.create({
    data: {
      organizationId,
      name: body.name,
      slug,
      ...(body.description ? { description: body.description } : {}),
      ...(body.color ? { color: body.color } : {}),
    },
  });
  // Every project starts with a single default language that owns its page tree.
  await prisma.language.create({
    data: { projectId: project.id, code: 'en', label: 'English', direction: 'LTR', isDefault: true, position: 0 },
  });
  return project;
};

export const getProject = async (organizationId: string, id: string) => {
  const project = await prisma.project.findFirst({
    where: { id, organizationId },
    include: {
      _count: { select: { pages: true, deployments: true, domains: true } },
      languages: { orderBy: [{ position: 'asc' }] },
    },
  });
  if (!project) {
    throw notFound('project', { id });
  }
  return project;
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

  let configData: Prisma.InputJsonValue | undefined;
  let colorFromConfig: string | undefined;
  if (body.config !== undefined) {
    const existing = (project.config as ProjectConfig | null) ?? {};
    const merged = mergeConfig(existing, body.config);
    configData = merged as Prisma.InputJsonValue;
    if (body.config.styling?.primaryColor) {
      colorFromConfig = body.config.styling.primaryColor;
    }
  }

  return prisma.project.update({
    where: { id },
    data: {
      ...(body.name === undefined ? {} : { name: body.name }),
      ...(body.description === undefined ? {} : { description: body.description }),
      ...(body.icon === undefined ? {} : { icon: body.icon }),
      ...(colorFromConfig !== undefined ? { color: colorFromConfig } : body.color === undefined ? {} : { color: body.color }),
      ...(body.logoUrl === undefined ? {} : { logoUrl: body.logoUrl }),
      ...(body.faviconUrl === undefined ? {} : { faviconUrl: body.faviconUrl }),
      ...(body.theme === undefined ? {} : { theme: body.theme === null ? Prisma.JsonNull : (body.theme as Prisma.InputJsonValue) }),
      ...(configData === undefined ? {} : { config: configData }),
    },
  });
};

export const deleteProject = async (organizationId: string, id: string) => {
  await assertProjectInOrg(organizationId, id);
  await prisma.project.delete({ where: { id } });
  return { id };
};
