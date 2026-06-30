import { Prisma, prisma } from '@midad/database';
import type { CreateLanguageBody, UpdateLanguageBody } from '@midad/validators';
import { conflict, notFound } from '@/errors';

/** Throw unless the language exists and belongs to the project. Returns it. */
export const assertLanguageInProject = async (projectId: string, id: string) => {
  const language = await prisma.language.findFirst({ where: { id, projectId } });
  if (!language) {
    throw notFound('language', { id });
  }
  return language;
};

/** Every language of a project, ordered for the language switcher. */
export const listLanguages = (projectId: string) =>
  prisma.language.findMany({ where: { projectId }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] });

/** The project's default language: the `isDefault` one, else the first by position, else null. */
export const getDefaultLanguage = async (projectId: string) => {
  const byDefault = await prisma.language.findFirst({ where: { projectId, isDefault: true } });
  if (byDefault) {
    return byDefault;
  }
  return prisma.language.findFirst({ where: { projectId }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] });
};

export const createLanguage = async (projectId: string, body: CreateLanguageBody) => {
  const max = await prisma.language.aggregate({ where: { projectId }, _max: { position: true } });
  const count = await prisma.language.count({ where: { projectId } });
  const isDefault = body.isDefault === true || count === 0;
  try {
    const created = await prisma.$transaction(async (tx) => {
      if (isDefault) {
        await tx.language.updateMany({ where: { projectId, isDefault: true }, data: { isDefault: false } });
      }
      return tx.language.create({
        data: {
          projectId,
          code: body.code,
          label: body.label,
          direction: body.direction ?? 'LTR',
          isDefault,
          position: (max._max.position ?? -1) + 1,
        },
      });
    });
    return created;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw conflict('A language with that code already exists.', { code: body.code });
    }
    throw error;
  }
};

/** Deep-merge a language-config patch: `seo` merges key-by-key; `null` clears. */
const mergeLanguageConfig = (existing: unknown, patch: UpdateLanguageBody['config']): object | null | undefined => {
  if (patch === undefined) {
    return undefined;
  }
  if (patch === null) {
    return null;
  }
  const base = (existing ?? {}) as Record<string, unknown>;
  const baseSeo = (base.seo ?? {}) as Record<string, unknown>;
  return { ...base, ...patch, ...(patch.seo ? { seo: { ...baseSeo, ...patch.seo } } : {}) };
};

export const updateLanguage = async (projectId: string, id: string, body: UpdateLanguageBody) => {
  const language = await assertLanguageInProject(projectId, id);
  const nextConfig = mergeLanguageConfig(language.config, body.config);
  return prisma.$transaction(async (tx) => {
    if (body.isDefault === true) {
      await tx.language.updateMany({ where: { projectId, isDefault: true }, data: { isDefault: false } });
    }
    return tx.language.update({
      where: { id },
      data: {
        ...(body.label === undefined ? {} : { label: body.label }),
        ...(body.direction === undefined ? {} : { direction: body.direction }),
        ...(body.position === undefined ? {} : { position: body.position }),
        ...(body.isDefault === undefined ? {} : { isDefault: body.isDefault }),
        ...(nextConfig === undefined ? {} : { config: nextConfig ?? Prisma.JsonNull }),
      },
    });
  });
};

export const deleteLanguage = async (projectId: string, id: string) => {
  const language = await assertLanguageInProject(projectId, id);
  if (language.isDefault) {
    throw conflict("Can't delete the default language.", { id });
  }
  const count = await prisma.language.count({ where: { projectId } });
  if (count <= 1) {
    throw conflict('A project needs at least one language.', { id });
  }
  await prisma.language.delete({ where: { id } });
  return { id };
};

/** Ensure the project has a default language, creating an English one if none exist. */
export const ensureDefaultLanguage = async (projectId: string) => {
  const existing = await getDefaultLanguage(projectId);
  if (existing) {
    return existing;
  }
  return prisma.language.create({
    data: { projectId, code: 'en', label: 'English', direction: 'LTR', isDefault: true, position: 0 },
  });
};
