import { type Prisma, prisma } from '@nibleaf/database';
import { slugify } from '@nibleaf/shared';
import type { MintlifyImportBody, ProjectConfig } from '@nibleaf/validators';
import { badRequest, ImportError } from '@/errors';
import { importDocumentSchema } from '@/validators/importers';
import { createImportReplacementBranch, promoteImportReplacementBranch } from '../branches';
import { createLanguage, updateLanguage } from '../languages';
import { assertProjectInOrg } from '../projects';
import { deriveTitle, MAX_IMPORT_FILES, parseFrontmatter, stableHash } from './content';
import { RemoteAssetMigrator } from './ghost-assets';
import { getGitHubDefaultBranch, getGitHubTextFile, githubRawUrl, listGitHubFiles } from './github';
import { resolveMintlifyConfigAsset, rewriteMintlifyAssetReferences } from './mintlify-assets';
import { buildMintlifyRouteMap, mintlifyInternalLinkTargets, rewriteMintlifyInternalLinks } from './mintlify-links';
import {
  findMintlifyConfigPath,
  type MintlifyLanguageNavigation,
  mapMintlifyConfig,
  mergeConfigPreservingExisting,
  type NavNode,
  parseMintlifyLanguages,
  parseMintlifyNavigation,
  partitionMintlifyVersions,
} from './mintlify-mapping';
import { normalizeMintlifyMdx } from './mintlify-mdx';
import { resolveMintlifyReferences } from './mintlify-references';
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
    const textCache = new Map<string, Promise<string | null>>();
    const loadText = (filePath: string) => {
      const cached = textCache.get(filePath);
      if (cached) return cached;
      const pending = getGitHubTextFile(owner, name, branch, filePath);
      textCache.set(filePath, pending);
      return pending;
    };

    const configPath = findMintlifyConfigPath([...blobs]);
    if (!configPath) {
      throw badRequest('No docs.json or mint.json found — is this a Mintlify docs repository?');
    }
    const rawConfig = await loadText(configPath);
    if (rawConfig === null) {
      throw badRequest(`Could not download ${configPath} from the repository.`);
    }
    let parsedConfig: unknown;
    try {
      parsedConfig = JSON.parse(rawConfig);
    } catch (error) {
      throw new ImportError({ code: 'import:invalid_document', message: `Could not parse ${configPath} — it is not valid JSON.`, cause: error });
    }
    const resolvedConfig = await resolveMintlifyReferences(parsedConfig, configPath, blobs, loadText);
    const checkedConfig = importDocumentSchema.safeParse(resolvedConfig);
    if (!checkedConfig.success) {
      throw new ImportError({ code: 'import:invalid_document', message: `Could not parse ${configPath} — it is not valid JSON.` });
    }
    const config = checkedConfig.data;

    const replacementBranch = await createImportReplacementBranch(projectId, 'mintlify', input.replaceExisting !== true);
    try {
      const summary = emptySummary();
      // Nav page paths are relative to the config file's directory.
      const baseDir = configPath.includes('/') ? `${configPath.slice(0, configPath.lastIndexOf('/'))}/` : '';
      const repository = { owner, name, branch, loadText };
      const currentTarget = await defaultImportTarget(projectId);
      const defaultTarget = { ...currentTarget, branchId: replacementBranch.id };
      const assets = new RemoteAssetMigrator(projectId, 'mintlify');
      const state = { pages: 0, capWarned: false, versions: new Set<string>() };
      const languageResult = parseMintlifyLanguages(config);
      summary.warnings.push(...languageResult.warnings);
      let chromeNodes: NavNode[];

      if (languageResult.languages.length > 0) {
        chromeNodes = languageResult.languages.find((language) => language.isDefault)?.nodes ?? languageResult.languages[0]?.nodes ?? [];
        const orderedLanguages = languageResult.languages
          .map((language, position) => ({ language, position }))
          .sort((left, right) => Number(right.language.isDefault) - Number(left.language.isDefault));
        for (const { language, position } of orderedLanguages) {
          const target = await ensureLanguageTarget(projectId, defaultTarget, language, position);
          await importNavigation(language.nodes, target, language.code, repository, baseDir, blobs, assets, summary, state);
        }
      } else {
        const { nodes, warnings: navWarnings } = parseMintlifyNavigation(config);
        summary.warnings.push(...navWarnings);
        if (nodes.length === 0) {
          throw badRequest(`${configPath} has an empty navigation — nothing to import.`);
        }
        chromeNodes = nodes;
        await importNavigation(nodes, defaultTarget, undefined, repository, baseDir, blobs, assets, summary, state);
      }
      if (state.versions.size > 0) {
        summary.warnings.push(`Imported Mintlify versions as Nibleaf documentation versions: ${[...state.versions].join(', ')}.`);
      }
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
      const { config: patch, warnings: configWarnings } = mapMintlifyConfig(config, chromeNodes, {
        resolveRepoAsset: (path) => resolveMintlifyConfigAsset(path, configPath, blobs, rawRepoUrl),
      });
      summary.warnings.push(...configWarnings);
      let replacementConfig: Prisma.InputJsonValue | undefined;
      if (Object.keys(patch).length > 0) {
        const existing = (project.config as ProjectConfig | null) ?? {};
        const { merged, set, kept } = mergeConfigPreservingExisting(existing, patch);
        if (set.length > 0) {
          replacementConfig = merged as Prisma.InputJsonValue;
          summary.warnings.push(`Applied site settings from ${configPath}: ${set.join(', ')}.`);
        }
        if (kept.length > 0) {
          summary.warnings.push(`Kept your existing settings for: ${kept.join(', ')}.`);
        }
      }

      await promoteImportReplacementBranch(projectId, replacementBranch.id, replacementConfig);
      summary.warnings.push('Replaced the existing draft navigation only after the complete Mintlify import succeeded.');

      return summary;
    } catch (error) {
      await prisma.branch.deleteMany({ where: { id: replacementBranch.id, projectId, isDefault: false } }).catch(() => undefined);
      throw error;
    }
  },
};

const ensureVersionTarget = async (
  projectId: string,
  defaultTarget: ImportTarget,
  version: { name: string; isDefault: boolean },
  summary: ImportSummary,
): Promise<ImportTarget> => {
  if (version.isDefault) {
    const branch = await prisma.branch.findUnique({ where: { id: defaultTarget.branchId } });
    if (!branch) throw badRequest('The project needs a default documentation version before content can be imported.');
    if (branch.name !== version.name) {
      const collision = await prisma.branch.findFirst({ where: { projectId, name: version.name } });
      if (!collision) {
        await prisma.branch.update({ where: { id: branch.id }, data: { name: version.name } });
      } else if (collision.id !== branch.id) {
        summary.warnings.push(`Kept the existing default version "${branch.name}" because a separate "${version.name}" version already exists.`);
        return { ...defaultTarget, branchId: collision.id };
      }
    }
    return defaultTarget;
  }
  const existing = await prisma.branch.findFirst({ where: { projectId, name: version.name } });
  const branch = existing ?? (await prisma.branch.create({ data: { projectId, name: version.name, isDefault: false } }));
  return { ...defaultTarget, branchId: branch.id };
};

const importNavigation = async (
  sourceNodes: readonly NavNode[],
  defaultTarget: ImportTarget,
  languageCode: string | undefined,
  repository: RepoRef,
  baseDir: string,
  blobs: ReadonlySet<string>,
  assets: RemoteAssetMigrator,
  summary: ImportSummary,
  state: { pages: number; capWarned: boolean; versions: Set<string> },
) => {
  const { unversioned, versions } = partitionMintlifyVersions(sourceNodes);
  const partitions =
    versions.length === 0
      ? [{ nodes: [...unversioned], target: defaultTarget }]
      : await Promise.all(
          [...versions]
            .sort((left, right) => Number(right.isDefault) - Number(left.isDefault))
            .map(async (version) => {
              state.versions.add(version.name);
              return {
                nodes: version.isDefault ? [...unversioned, ...version.nodes] : [...version.nodes],
                target: await ensureVersionTarget(defaultTarget.projectId, defaultTarget, version, summary),
              };
            }),
        );
  for (const partition of partitions) {
    await addLinkedPages(partition.nodes, languageCode, repository, baseDir, blobs, summary);
    const removedPlaceholders = await removeImportPlaceholders(partition.target);
    if (removedPlaceholders > 0) {
      summary.warnings.push(
        `Removed ${removedPlaceholders} untouched starter placeholder page${removedPlaceholders === 1 ? '' : 's'}${languageCode ? ` from ${languageCode}` : ''}.`,
      );
    }
    await importNodes(
      partition.nodes,
      null,
      repository,
      baseDir,
      blobs,
      partition.target,
      assets,
      buildMintlifyRouteMap(partition.nodes),
      summary,
      state,
      languageCode,
    );
  }
};

const ensureLanguageTarget = async (
  projectId: string,
  defaultTarget: ImportTarget,
  language: MintlifyLanguageNavigation,
  position: number,
): Promise<ImportTarget> => {
  const existing = await prisma.language.findFirst({
    where: { projectId, code: { equals: language.code, mode: 'insensitive' } },
  });
  const body = {
    label: language.label,
    direction: language.direction,
    position,
    enabled: language.isDefault ? true : language.enabled,
    ...(language.isDefault ? { isDefault: true } : {}),
    ...(language.config ? { config: language.config } : {}),
    ...(language.translation ? { translation: language.translation } : {}),
  } as const;
  const persisted = existing
    ? await updateLanguage(projectId, existing.id, body)
    : await createLanguage(projectId, {
        code: language.code,
        label: language.label,
        direction: language.direction,
        isDefault: language.isDefault,
        enabled: language.isDefault ? true : language.enabled,
      });
  if (!existing && (language.config || language.translation)) {
    await updateLanguage(projectId, persisted.id, {
      ...(language.config ? { config: language.config } : {}),
      ...(language.translation ? { translation: language.translation } : {}),
      position,
    });
  }
  return { projectId, branchId: defaultTarget.branchId, languageId: persisted.id };
};

interface RepoRef {
  owner: string;
  name: string;
  branch: string;
  loadText(filePath: string): Promise<string | null>;
}

const stripLanguagePrefix = (path: string, languageCode: string): string => {
  const prefix = `${languageCode.toLowerCase()}/`;
  return path.toLowerCase().startsWith(prefix) ? path.slice(prefix.length) : path;
};

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

const addLinkedPages = async (
  nodes: NavNode[],
  languageCode: string | undefined,
  repo: RepoRef,
  baseDir: string,
  blobs: ReadonlySet<string>,
  summary: ImportSummary,
): Promise<void> => {
  const linkedPages = await discoverLinkedPages(nodes, repo, baseDir, blobs);
  if (linkedPages.length === 0) return;
  nodes.push({
    kind: 'group',
    title: siteT(languageCode)('importAdditionalPages'),
    origin: 'group',
    children: linkedPages.map((path) => ({ kind: 'page', path })),
  });
  summary.warnings.push(
    `Imported ${linkedPages.length} linked page${linkedPages.length === 1 ? ' that was' : 's that were'} not listed in ${languageCode ? `${languageCode} ` : ''}Mintlify navigation.`,
  );
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
    const raw = await repo.loadText(filePath);
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
  blobs: ReadonlySet<string>,
  target: ImportTarget,
  assets: RemoteAssetMigrator,
  routeMap: ReadonlyMap<string, string>,
  summary: ImportSummary,
  state: { pages: number; capWarned: boolean },
  languageCode?: string,
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
      let groupSlug = slugify(node.slug ?? node.title);
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
      await importNodes(node.children, groupId, repo, baseDir, blobs, target, assets, routeMap, summary, state, languageCode);
      continue;
    }

    const candidates = [`${baseDir}${node.path}.mdx`, `${baseDir}${node.path}.md`];
    const filePath = candidates.find((candidate) => blobs.has(candidate));
    if (!filePath) {
      summary.warnings.push(`Navigation page "${node.path}" was not found in the repository.`);
      summary.skipped++;
      continue;
    }
    const raw = await repo.loadText(filePath);
    if (raw === null) {
      summary.warnings.push(`Could not download "${filePath}" — the page was skipped.`);
      summary.skipped++;
      continue;
    }
    state.pages++;

    // MDX imports as-is (the editor/renderer handles Mintlify-style components);
    // only the frontmatter is stripped into title/description/icon.
    const { meta, body } = parseFrontmatter(raw);
    if (languageCode && meta.lang && meta.lang.toLowerCase() !== languageCode.toLowerCase()) {
      summary.warnings.push(`Page "${node.path}" declares lang "${meta.lang}" but is navigated under "${languageCode}".`);
    }
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
    const content = normalizeMintlifyMdx(await assets.rewrite(assetReferences.content));
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
      ...(languageCode
        ? {
            translationKey: (meta.translation_key || stripLanguagePrefix(node.path, languageCode)).slice(0, 120),
          }
        : {}),
      position,
    });
    summary[outcome === 'imported' ? 'imported' : 'updated']++;
  }
};

import { siteT } from '@nibleaf/i18n/site';
