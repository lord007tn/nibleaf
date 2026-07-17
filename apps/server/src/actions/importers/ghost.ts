import { slugify } from '@nibleaf/shared';
import type { GhostImportBody } from '@nibleaf/validators';
import { badRequest } from '@/errors';
import { getDefaultBranch } from '../branches';
import { listLanguages } from '../languages';
import { assertProjectInOrg } from '../projects';
import { humanize, MAX_IMPORT_FILES } from './content';
import { GhostAssetMigrator } from './ghost-assets';
import {
  byPublishedAt,
  type GhostContentItem,
  GhostExportError,
  ghostImportSourceUrl,
  ghostItemSlug,
  ghostItemToMarkdown,
  isGhostPlaceholder,
  parseGhostExport,
  resolveGhostLanguage,
} from './ghost-mapping';
import { ensureGroupPage, type ImportTarget, removeImportPlaceholders, upsertLeafPage } from './persistence';
import { emptySummary, type ImporterSource, type ImportSummary } from './types';

/**
 * Ghost importer: takes a Ghost JSON export (posted as the request body),
 * converts published posts and pages from HTML to Markdown, and files them
 * under top-level "Blog" / "Pages" groups. Same idempotent upsert-by-slug
 * semantics as the Git import — re-importing updates in place.
 */
export const ghostImporter: ImporterSource<GhostImportBody> = {
  id: 'ghost',

  async run({ organizationId, projectId, input }): Promise<ImportSummary> {
    await assertProjectInOrg(organizationId, projectId);

    let content: ReturnType<typeof parseGhostExport>;
    try {
      content = parseGhostExport(input);
    } catch (error) {
      if (error instanceof GhostExportError) {
        throw badRequest(error.message);
      }
      throw error;
    }
    const placeholderCount = [...content.posts, ...content.pages].filter(isGhostPlaceholder).length;
    const importedContent = {
      posts: content.posts.filter((item) => !isGhostPlaceholder(item)),
      pages: content.pages.filter((item) => !isGhostPlaceholder(item)),
    };
    if (importedContent.posts.length === 0 && importedContent.pages.length === 0) {
      throw badRequest('The Ghost export contains no published posts or pages.');
    }

    const [branch, languages] = await Promise.all([getDefaultBranch(projectId), listLanguages(projectId)]);
    const defaultLanguage = languages.find((language) => language.isDefault);
    if (!defaultLanguage) {
      throw badRequest('The project needs a default language before content can be imported.');
    }

    // Two-letter / regional Ghost tags are treated as language tags. Refuse to
    // silently put tagged content into the wrong tree when that project language
    // has not been configured yet.
    const configuredCodes = languages.map((language) => language.code);
    const localeTags = new Set(
      [...importedContent.posts, ...importedContent.pages].flatMap((item) => item.tags).filter((tag) => /^[a-z]{2}(?:-[a-z]{2})?$/i.test(tag)),
    );
    const missingLocaleTags = [...localeTags].filter(
      (tag) => !configuredCodes.some((code) => code.toLowerCase() === tag || code.toLowerCase().startsWith(`${tag}-`)),
    );
    if (missingLocaleTags.length > 0) {
      throw badRequest(`Add these project languages before importing their tagged Ghost articles: ${missingLocaleTags.sort().join(', ')}.`);
    }

    const targets = new Map(
      languages.map((language) => [language.code, { projectId, branchId: branch.id, languageId: language.id } satisfies ImportTarget]),
    );
    const summary = emptySummary();
    if (placeholderCount > 0) {
      summary.skipped += placeholderCount;
      summary.warnings.push(`Skipped ${placeholderCount} default Ghost “Coming soon” placeholder${placeholderCount === 1 ? '' : 's'}.`);
    }
    const ghostSourceUrl = ghostImportSourceUrl(input);
    const assets = new GhostAssetMigrator(projectId);
    const state = { pages: 0, capWarned: false, ghostUrlWarned: false, untagged: 0, ambiguous: 0 };
    await Promise.all([...targets.values()].map((target) => removeImportPlaceholders(target)));
    await importByLanguage(importedContent.posts, 'Blog', targets, configuredCodes, defaultLanguage.code, ghostSourceUrl, assets, summary, state);
    await importByLanguage(importedContent.pages, 'Pages', targets, configuredCodes, defaultLanguage.code, ghostSourceUrl, assets, summary, state);
    if (state.untagged > 0) {
      summary.warnings.push(`${state.untagged} Ghost item(s) had no configured language tag and were imported into ${defaultLanguage.code}.`);
    }
    if (state.ambiguous > 0) {
      summary.warnings.push(
        `${state.ambiguous} Ghost item(s) had multiple language tags; their writing script was used to choose among the tagged languages.`,
      );
    }
    summary.assetsImported = assets.migrated;
    summary.assetsSkipped = assets.skipped;
    if (assets.skipped > 0) {
      const reasons = [...assets.failures].slice(0, 3).join('; ');
      summary.warnings.push(
        `${assets.skipped} remote image(s) could not be copied into project storage${reasons ? ` (${reasons})` : ''}. Their source URLs were preserved.`,
      );
    }
    return summary;
  },
};

type ImportState = { pages: number; capWarned: boolean; ghostUrlWarned: boolean; untagged: number; ambiguous: number };

const importByLanguage = async (
  items: GhostContentItem[],
  groupTitle: 'Blog' | 'Pages',
  targets: ReadonlyMap<string, ImportTarget>,
  languageCodes: readonly string[],
  defaultCode: string,
  ghostSourceUrl: string | undefined,
  assets: GhostAssetMigrator,
  summary: ImportSummary,
  state: ImportState,
): Promise<void> => {
  const buckets = new Map<string, GhostContentItem[]>();
  for (const item of items) {
    const resolution = resolveGhostLanguage(item, languageCodes, defaultCode);
    if (resolution.reason === 'default') state.untagged++;
    if (resolution.reason === 'ambiguous-tags') state.ambiguous++;
    buckets.set(resolution.code, [...(buckets.get(resolution.code) ?? []), item]);
  }
  for (const [code, localizedItems] of buckets) {
    const target = targets.get(code);
    if (!target) continue;
    const localizedGroupTitle = code.toLowerCase().startsWith('ar') ? (groupTitle === 'Blog' ? 'المدونة' : 'الصفحات') : groupTitle;
    await importCollection(localizedItems, localizedGroupTitle, target, languageCodes, ghostSourceUrl, assets, summary, state);
  }
};

const importCollection = async (
  items: GhostContentItem[],
  groupTitle: string,
  target: ImportTarget,
  languageCodes: readonly string[],
  ghostSourceUrl: string | undefined,
  assets: GhostAssetMigrator,
  summary: ImportSummary,
  state: ImportState,
): Promise<void> => {
  if (items.length === 0) {
    return;
  }
  const groupId = await ensureGroupPage(target, { parentId: null, title: groupTitle, slug: slugify(groupTitle) });

  const ordered = [...items].sort(byPublishedAt);
  for (const [position, item] of ordered.entries()) {
    if (state.pages >= MAX_IMPORT_FILES) {
      if (!state.capWarned) {
        summary.warnings.push(`Import capped at ${MAX_IMPORT_FILES} pages — the remaining entries were skipped.`);
        state.capWarned = true;
      }
      summary.skipped++;
      continue;
    }
    state.pages++;

    const { slug, usedHashFallback } = ghostItemSlug(item, position);
    if (usedHashFallback) {
      summary.warnings.push(`"${item.title || item.slug}" has no Latin characters to build a slug from — imported as "${slug}".`);
    }
    const conversion = ghostItemToMarkdown(item, ghostSourceUrl);
    if (conversion.usedFallback) {
      summary.warnings.push(`"${item.title}" could not be fully converted from HTML — imported as plain text.`);
    }
    if (conversion.hadGhostUrls && !ghostSourceUrl && !state.ghostUrlWarned) {
      summary.warnings.push(
        'Some media used __GHOST_URL__ placeholders, but no Ghost site URL was provided. Those images remain relative; enter the source publication URL and import again to copy them into project storage.',
      );
      state.ghostUrlWarned = true;
    }
    const markdown = await assets.rewrite(conversion.markdown);
    const displayTags = item.tags
      .filter((tag) => !languageCodes.some((code) => code.toLowerCase() === tag || code.toLowerCase().startsWith(`${tag}-`)))
      .map(humanize)
      .slice(0, 10);
    const outcome = await upsertLeafPage(target, {
      parentId: groupId,
      slug,
      title: (item.title || humanize(slug)).slice(0, 200),
      content: markdown,
      ...(item.description ? { description: item.description.slice(0, 500) } : {}),
      ...(displayTags.length > 0 ? { config: { tag: displayTags[0]?.slice(0, 20), tags: displayTags } } : {}),
      position,
    });
    summary[outcome === 'imported' ? 'imported' : 'updated']++;
  }
};
