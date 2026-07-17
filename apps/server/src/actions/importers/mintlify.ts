import { prisma } from '@nibleaf/database';
import { slugify } from '@nibleaf/shared';
import type { MintlifyImportBody, ProjectConfig } from '@nibleaf/validators';
import { badRequest } from '@/errors';
import { assertProjectInOrg } from '../projects';
import { deriveTitle, MAX_IMPORT_FILES, parseFrontmatter, stableHash } from './content';
import { RemoteAssetMigrator } from './ghost-assets';
import { fetchRawText, getGitHubDefaultBranch, githubRawUrl, listGitHubFiles } from './github';
import { resolveMintlifyConfigAsset, rewriteMintlifyAssetReferences } from './mintlify-assets';
import { buildMintlifyRouteMap, mintlifyInternalLinkTargets, rewriteMintlifyInternalLinks } from './mintlify-links';
import { findMintlifyConfigPath, mapMintlifyConfig, mergeConfigPreservingExisting, type NavNode, parseMintlifyNavigation } from './mintlify-mapping';
import { defaultImportTarget, ensureGroupPage, type ImportTarget, removeImportPlaceholders, upsertLeafPage } from './persistence';
import { emptySummary, type ImporterSource, type ImportSummary } from './types';

/**
 * Mintlify importer: pull a public GitHub docs repo (docs.json 2024+ schema or
 * legacy mint.json) into pages — navigation groups become GROUP pages in nav
 * order, each referenced MDX page is imported as-is (frontmatter stripped into
 * title/description/icon), and the site chrome fills in any EMPTY project
 * config keys (existing settings are never clobbered).
 */
export const mintlifyImporter: ImporterSource<MintlifyImportBody> = {
  id: 'mintlify',

  async run({ organizationId, projectId, input }): Promise<ImportSummary> {
    const project = await assertProjectInOrg(organizationId, projectId);

    const [owner, name] = input.repo.split('/');
    if (!owner || !name) {
      throw badRequest('Use the form owner/repo.');
    }
    const branch = input.branch?.trim() || (await getGitHubDefaultBranch(owner, name));
    const tree = await listGitHubFiles(owner, name, branch);
    const blobs = new Set(tree.filter((item) => item.type === 'blob').map((item) => item.path));

    const configPath = findMintlifyConfigPath([...blobs]);
    if (!configPath) {
      throw badRequest('No docs.json or mint.json found — is this a Mintlify docs repository?');
    }
    const rawConfig = await fetchRawText(githubRawUrl(owner, name, branch, configPath));
    if (rawConfig === null) {
      throw badRequest(`Could not download ${configPath} from the repository.`);
    }
    let config: Record<string, unknown>;
    try {
      const parsed = JSON.parse(rawConfig) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('not an object');
      }
      config = parsed as Record<string, unknown>;
    } catch {
      throw badRequest(`Could not parse ${configPath} — it is not valid JSON.`);
    }

    const summary = emptySummary();
    const { nodes, warnings: navWarnings } = parseMintlifyNavigation(config);
    summary.warnings.push(...navWarnings);
    if (nodes.length === 0) {
      throw badRequest(`${configPath} has an empty navigation — nothing to import.`);
    }

    // Nav page paths are relative to the config file's directory.
    const baseDir = configPath.includes('/') ? `${configPath.slice(0, configPath.lastIndexOf('/'))}/` : '';
    const linkedPages = await discoverLinkedPages(nodes, { owner, name, branch }, baseDir, blobs);
    if (linkedPages.length > 0) {
      nodes.push({
        kind: 'group',
        title: 'Additional pages',
        origin: 'group',
        children: linkedPages.map((path) => ({ kind: 'page', path })),
      });
      summary.warnings.push(
        `Imported ${linkedPages.length} linked page${linkedPages.length === 1 ? '' : 's'} that were not listed in Mintlify navigation.`,
      );
    }
    const target = await defaultImportTarget(projectId);
    const removedPlaceholders = await removeImportPlaceholders(target);
    if (removedPlaceholders > 0) {
      summary.warnings.push(`Removed ${removedPlaceholders} untouched starter placeholder page${removedPlaceholders === 1 ? '' : 's'}.`);
    }
    const assets = new RemoteAssetMigrator(projectId, 'mintlify');
    const routeMap = buildMintlifyRouteMap(nodes);
    const state = { pages: 0, capWarned: false };
    await importNodes(nodes, null, { owner, name, branch }, baseDir, blobs, target, assets, routeMap, summary, state);
    summary.assetsImported = assets.migrated;
    summary.assetsSkipped = assets.skipped;
    if (assets.skipped > 0) {
      const reasons = [...assets.failures].slice(0, 3).join('; ');
      summary.warnings.push(
        `${assets.skipped} Mintlify image(s) could not be copied into project storage${reasons ? ` (${reasons})` : ''}. Their source references were preserved.`,
      );
    }

    // Site chrome → project config, but only into keys that are currently empty.
    const rawRepoUrl = (path: string) => githubRawUrl(owner, name, branch, path);
    const { config: patch, warnings: configWarnings } = mapMintlifyConfig(config, nodes, {
      resolveRepoAsset: (path) => resolveMintlifyConfigAsset(path, configPath, blobs, rawRepoUrl),
    });
    summary.warnings.push(...configWarnings);
    if (Object.keys(patch).length > 0) {
      const existing = (project.config as ProjectConfig | null) ?? {};
      const { merged, set, kept } = mergeConfigPreservingExisting(existing, patch);
      if (set.length > 0) {
        await prisma.project.update({ where: { id: projectId }, data: { config: merged as object } });
        summary.warnings.push(`Applied site settings from ${configPath}: ${set.join(', ')}.`);
      }
      if (kept.length > 0) {
        summary.warnings.push(`Kept your existing settings for: ${kept.join(', ')}.`);
      }
    }

    return summary;
  },
};

interface RepoRef {
  owner: string;
  name: string;
  branch: string;
}

const navPagePaths = (nodes: readonly NavNode[]): Set<string> => {
  const paths = new Set<string>();
  const visit = (items: readonly NavNode[]) => {
    for (const node of items) {
      if (node.kind === 'page') paths.add(node.path.replace(/^\/+|\/+$/g, '').replace(/\.(?:md|mdx)$/i, ''));
      else visit(node.children);
    }
  };
  visit(nodes);
  return paths;
};

/** Mintlify allows linked pages to remain outside navigation. Follow internal
 * links recursively and add only real repo pages, keeping partials/assets out. */
const discoverLinkedPages = async (nodes: readonly NavNode[], repo: RepoRef, baseDir: string, blobs: ReadonlySet<string>): Promise<string[]> => {
  const known = navPagePaths(nodes);
  const queue = [...known];
  const additional: string[] = [];
  for (let index = 0; index < queue.length && known.size < MAX_IMPORT_FILES; index++) {
    const sourcePath = queue[index];
    if (!sourcePath) continue;
    const candidates = [`${baseDir}${sourcePath}.mdx`, `${baseDir}${sourcePath}.md`];
    const filePath = candidates.find((candidate) => blobs.has(candidate));
    if (!filePath) continue;
    const raw = await fetchRawText(githubRawUrl(repo.owner, repo.name, repo.branch, filePath));
    if (raw === null) continue;
    const { body } = parseFrontmatter(raw);
    for (const target of mintlifyInternalLinkTargets(body, sourcePath)) {
      if (known.has(target)) continue;
      const targetExists = blobs.has(`${baseDir}${target}.mdx`) || blobs.has(`${baseDir}${target}.md`);
      if (!targetExists) continue;
      known.add(target);
      additional.push(target);
      queue.push(target);
    }
  }
  return additional;
};

/** Depth-first import of the nav tree; the array index is the sibling position. */
const importNodes = async (
  nodes: NavNode[],
  parentId: string | null,
  repo: RepoRef,
  baseDir: string,
  blobs: Set<string>,
  target: ImportTarget,
  assets: RemoteAssetMigrator,
  routeMap: ReadonlyMap<string, string>,
  summary: ImportSummary,
  state: { pages: number; capWarned: boolean },
): Promise<void> => {
  // Slug ledger (slug → nav path) for THIS parent's children; a fresh map per
  // invocation gives per-parent scoping through the recursion. Two sibling nav
  // paths sharing a basename (sdk/overview vs api/overview) would otherwise
  // upsert into one page — the later one deterministically takes its full-path
  // slug instead, so re-imports land on the same pages every time.
  const usedSlugs = new Map<string, string>();
  for (const [position, node] of nodes.entries()) {
    // The cap bounds every CREATED node — groups included — so a hostile or
    // enormous nav tree can't fan out unbounded GROUP rows either.
    if (state.pages >= MAX_IMPORT_FILES) {
      if (!state.capWarned) {
        summary.warnings.push(`Import capped at ${MAX_IMPORT_FILES} pages — remaining navigation entries were skipped.`);
        state.capWarned = true;
      }
      summary.skipped++;
      continue;
    }

    if (node.kind === 'group') {
      let groupSlug = slugify(node.title);
      if (!groupSlug) {
        groupSlug = `group-${stableHash(node.title)}`;
        summary.warnings.push(`Group "${node.title}" has no Latin characters to build a slug from — imported as "${groupSlug}".`);
      }
      state.pages++;
      const groupId = await ensureGroupPage(target, {
        parentId,
        title: node.title.slice(0, 200),
        slug: groupSlug,
        ...(node.icon ? { icon: node.icon.slice(0, 64) } : {}),
        position,
      });
      await importNodes(node.children, groupId, repo, baseDir, blobs, target, assets, routeMap, summary, state);
      continue;
    }

    const candidates = [`${baseDir}${node.path}.mdx`, `${baseDir}${node.path}.md`];
    const filePath = candidates.find((candidate) => blobs.has(candidate));
    if (!filePath) {
      summary.warnings.push(`Navigation page "${node.path}" was not found in the repository.`);
      summary.skipped++;
      continue;
    }
    const raw = await fetchRawText(githubRawUrl(repo.owner, repo.name, repo.branch, filePath));
    if (raw === null) {
      summary.warnings.push(`Could not download "${filePath}" — the page was skipped.`);
      summary.skipped++;
      continue;
    }
    state.pages++;

    // MDX imports as-is (the editor/renderer handles Mintlify-style components);
    // only the frontmatter is stripped into title/description/icon.
    const { meta, body } = parseFrontmatter(raw);
    const linkedBody = rewriteMintlifyInternalLinks(body, node.path, routeMap);
    const assetReferences = rewriteMintlifyAssetReferences(
      linkedBody,
      filePath,
      blobs,
      (path) => githubRawUrl(repo.owner, repo.name, repo.branch, path),
      baseDir,
    );
    if (assetReferences.missing.length > 0) {
      summary.warnings.push(
        `Page "${node.path}" references ${assetReferences.missing.length} image${assetReferences.missing.length === 1 ? '' : 's'} not found in the repository: ${assetReferences.missing.slice(0, 3).join(', ')}.`,
      );
    }
    const content = await assets.rewrite(assetReferences.content);
    const fileBase = node.path.split('/').filter(Boolean).pop() ?? 'page';
    let slug = slugify(fileBase);
    if (!slug) {
      slug = `page-${stableHash(node.path)}`;
      summary.warnings.push(`Page "${node.path}" has no Latin characters to build a slug from — imported as "${slug}".`);
    }
    const claimedBy = usedSlugs.get(slug);
    if (claimedBy !== undefined && claimedBy !== node.path) {
      const fullPathSlug = slugify(node.path.split('/').filter(Boolean).join('-')) || `page-${stableHash(node.path)}`;
      summary.warnings.push(`Pages "${claimedBy}" and "${node.path}" share the slug "${slug}" — "${node.path}" was imported as "${fullPathSlug}".`);
      slug = fullPathSlug;
    }
    usedSlugs.set(slug, node.path);
    const outcome = await upsertLeafPage(target, {
      parentId,
      slug,
      title: (node.title ?? deriveTitle(meta, body, fileBase)).slice(0, 200),
      content,
      ...(meta.description ? { description: meta.description.slice(0, 500) } : {}),
      ...(node.icon || meta.icon ? { icon: (node.icon ?? meta.icon)?.slice(0, 64) } : {}),
      ...(node.tag || meta.tag
        ? {
            config: {
              tag: (node.tag ?? meta.tag)?.slice(0, 20),
              tags: [(node.tag ?? meta.tag)?.slice(0, 40)].filter((tag): tag is string => Boolean(tag)),
            },
          }
        : {}),
      position,
    });
    summary[outcome === 'imported' ? 'imported' : 'updated']++;
  }
};
