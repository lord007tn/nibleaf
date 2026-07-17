import { slugify } from '@nibleaf/shared';
import type { GhostImportBody } from '@nibleaf/validators';
import { badRequest } from '@/errors';
import { assertProjectInOrg } from '../projects';
import { humanize, MAX_IMPORT_FILES } from './content';
import { byPublishedAt, type GhostContentItem, GhostExportError, ghostItemSlug, ghostItemToMarkdown, parseGhostExport } from './ghost-mapping';
import { defaultImportTarget, ensureGroupPage, type ImportTarget, upsertLeafPage } from './persistence';
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
    if (content.posts.length === 0 && content.pages.length === 0) {
      throw badRequest('The Ghost export contains no published posts or pages.');
    }

    const target = await defaultImportTarget(projectId);
    const summary = emptySummary();
    const state = { pages: 0, capWarned: false, ghostUrlWarned: false };
    await importCollection(content.posts, 'Blog', target, summary, state);
    await importCollection(content.pages, 'Pages', target, summary, state);
    return summary;
  },
};

const importCollection = async (
  items: GhostContentItem[],
  groupTitle: 'Blog' | 'Pages',
  target: ImportTarget,
  summary: ImportSummary,
  state: { pages: number; capWarned: boolean; ghostUrlWarned: boolean },
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
    const conversion = ghostItemToMarkdown(item);
    if (conversion.usedFallback) {
      summary.warnings.push(`"${item.title}" could not be fully converted from HTML — imported as plain text.`);
    }
    if (conversion.hadGhostUrls && !state.ghostUrlWarned) {
      summary.warnings.push(
        'Some media URLs pointed at the Ghost site (__GHOST_URL__) and were made relative — re-upload those images to keep them working.',
      );
      state.ghostUrlWarned = true;
    }
    const outcome = await upsertLeafPage(target, {
      parentId: groupId,
      slug,
      title: (item.title || humanize(slug)).slice(0, 200),
      content: conversion.markdown,
      ...(item.description ? { description: item.description.slice(0, 500) } : {}),
      position,
    });
    summary[outcome === 'imported' ? 'imported' : 'updated']++;
  }
};
