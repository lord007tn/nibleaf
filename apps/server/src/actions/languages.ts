import { Prisma, prisma } from '@nibleaf/database';
import { isPageTranslation } from '@nibleaf/shared/site';
import type { CreateLanguageBody, UpdateLanguageBody } from '@nibleaf/validators';
import { z } from 'zod';
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
  prisma.language
    .findMany({
      where: { projectId },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      include: { projectTranslations: { where: { projectId }, take: 1 } },
    })
    .then((languages) => languages.map(({ projectTranslations, ...language }) => ({ ...language, translation: projectTranslations[0] ?? null })));

/** Languages plus default-branch content coverage for the settings dashboard.
 * Matching deliberately mirrors published hreflang behavior: translation keys
 * win, while pages without one pair by path. A target page can satisfy only one
 * source page, so duplicate keys never inflate coverage. */
export const listLanguagesWithCoverage = async (projectId: string) => {
  const [languages, pages] = await Promise.all([
    listLanguages(projectId),
    prisma.page.findMany({
      where: { projectId, kind: 'PAGE', branch: { isDefault: true } },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, languageId: true, path: true, translationKey: true },
    }),
  ]);
  const defaultLanguage = languages.find((language) => language.isDefault);
  const sourcePages = defaultLanguage ? pages.filter((page) => page.languageId === defaultLanguage.id) : [];

  return languages.map((language) => {
    const languagePages = pages.filter((page) => page.languageId === language.id);
    const unmatched = language.isDefault ? [] : [...languagePages];
    let matchedPages = language.isDefault ? sourcePages.length : 0;
    for (const source of language.isDefault ? [] : sourcePages) {
      const matchIndex = unmatched.findIndex((candidate) => isPageTranslation(source, candidate));
      if (matchIndex >= 0) {
        matchedPages++;
        unmatched.splice(matchIndex, 1);
      }
    }
    const sourcePageCount = sourcePages.length;
    return {
      ...language,
      coverage: {
        pageCount: languagePages.length,
        sourcePageCount,
        matchedPages,
        missingPages: Math.max(0, sourcePageCount - matchedPages),
        extraPages: language.isDefault ? 0 : unmatched.length,
        percentage: sourcePageCount === 0 ? null : Math.round((matchedPages / sourcePageCount) * 100),
      },
    };
  });
};

/** The project's required default language. Missing data is an invariant error. */
export const getDefaultLanguage = async (projectId: string) => {
  const defaults = await prisma.language.findMany({ where: { projectId, isDefault: true }, take: 2 });
  if (defaults.length !== 1 || !defaults[0]) {
    throw new Error(`Project ${projectId} must have exactly one default language.`);
  }
  return defaults[0];
};

export const createLanguage = async (projectId: string, body: CreateLanguageBody) => {
  const max = await prisma.language.aggregate({ where: { projectId }, _max: { position: true } });
  const isDefault = body.isDefault === true;
  // The default language always serves — it is every visitor's fallback.
  if (isDefault && body.enabled === false) {
    throw conflict("The default language can't be disabled.", { code: body.code });
  }
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
          enabled: body.enabled ?? true,
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

/** Chrome override sections stored on a language's config. The UI always sends
 *  a section's FULL override object (or `null` to clear it), so these replace
 *  wholesale on merge instead of merging key-by-key like `seo`. */
const CHROME_SECTIONS = ['navbar', 'footer', 'banner', 'search'] as const;

const isEmptyObject = (value: unknown) => {
  const parsed = z.record(z.string(), z.unknown()).safeParse(value);
  return parsed.success && Object.keys(parsed.data).length === 0;
};

/** Deep-merge a language-config patch: `seo` merges key-by-key, and `null` clears the whole
 *  config. Omitted keys keep their stored value — the UI sends explicit empty
 *  strings to clear a single field (consumers treat `''` as no override).
 *  Chrome sections (navbar/footer/banner/search) replace wholesale; sending
 *  `null` (or `{}`) for one removes just that override so it falls back to the
 *  project config. A whole-config `null` clears SEO overrides but PRESERVES
 *  stored chrome sections — the settings forms that send it only manage SEO
 *  and don't know about chrome
 *  overrides, so honoring it literally would silently wipe another section's
 *  data. A config left with no keys is stored as null. */
const mergeLanguageConfig = (existing: unknown, patch: UpdateLanguageBody['config']): object | null | undefined => {
  if (patch === undefined) {
    return undefined;
  }
  if (patch === null) {
    const base = (existing ?? {}) as Record<string, unknown>;
    const kept: Record<string, unknown> = {};
    for (const section of CHROME_SECTIONS) {
      if (base[section] !== undefined && base[section] !== null) {
        kept[section] = base[section];
      }
    }
    return Object.keys(kept).length === 0 ? null : kept;
  }
  const base = (existing ?? {}) as Record<string, unknown>;
  const baseSeo = (base.seo ?? {}) as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...base, ...patch, ...(patch.seo ? { seo: { ...baseSeo, ...patch.seo } } : {}) };
  for (const section of CHROME_SECTIONS) {
    const value = (patch as Record<string, unknown>)[section];
    if (value === null || isEmptyObject(value)) {
      delete merged[section];
    }
  }
  return Object.keys(merged).length === 0 ? null : merged;
};

export const updateLanguage = async (projectId: string, id: string, body: UpdateLanguageBody) => {
  const language = await assertLanguageInProject(projectId, id);
  if (language.isDefault && body.isDefault === false) {
    throw conflict("Can't unset the default language. Make another language default instead.", { id });
  }
  // The default language always serves: it can't be disabled, and a language
  // being promoted to default can't be disabled in the same request.
  if (body.enabled === false && (body.isDefault === true || (language.isDefault && body.isDefault !== false))) {
    throw conflict("The default language can't be disabled. Make another language default first.", { id });
  }
  return prisma.$transaction(async (tx) => {
    // The config merge must not be a read-modify-write race: re-read the row
    // INSIDE the transaction so the merge base is fresh, not the pre-transaction
    // snapshot — two concurrent updates would otherwise resurrect each other's
    // overwritten sections. (The codebase avoids raw SQL, so this is a fresh
    // re-read rather than a SELECT … FOR UPDATE row lock.)
    const fresh = await tx.language.findUnique({ where: { id } });
    if (!fresh || fresh.projectId !== projectId) {
      throw notFound('language', { id });
    }
    const nextConfig = mergeLanguageConfig(fresh.config, body.config);
    if (body.isDefault === true) {
      await tx.language.updateMany({ where: { projectId, isDefault: true }, data: { isDefault: false } });
    }
    if (body.translation !== undefined) {
      const name = body.translation?.name?.trim() || null;
      const description = body.translation?.description?.trim() || null;
      if (!(name || description)) {
        await tx.projectTranslation.deleteMany({ where: { projectId, languageId: id } });
      } else {
        await tx.projectTranslation.upsert({
          where: { projectId_languageId: { projectId, languageId: id } },
          create: { projectId, languageId: id, name, description },
          update: { name, description },
        });
      }
    }
    const updated = await tx.language.update({
      where: { id },
      data: {
        ...(body.label === undefined ? {} : { label: body.label }),
        ...(body.direction === undefined ? {} : { direction: body.direction }),
        ...(body.position === undefined ? {} : { position: body.position }),
        ...(body.isDefault === undefined ? {} : { isDefault: body.isDefault }),
        // Promoting a disabled language to default re-enables it (the default
        // must always serve).
        ...(body.isDefault === true ? { enabled: true } : body.enabled === undefined ? {} : { enabled: body.enabled }),
        ...(nextConfig === undefined ? {} : { config: nextConfig ?? Prisma.JsonNull }),
      },
    });
    const translation = await tx.projectTranslation.findUnique({ where: { projectId_languageId: { projectId, languageId: id } } });
    return { ...updated, translation };
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
