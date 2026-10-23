import { type Prisma, prisma } from '@nibleaf/database';
import { MAX_REDIRECT_RULES, validateRedirectGraph } from '@nibleaf/shared/redirects';
import type { GitbookImportBody, PageConfig, ProjectConfig } from '@nibleaf/validators';
import { badRequest } from '@/errors';
import { createImportReplacementBranch, promoteImportReplacementBranch } from '../branches';
import { assertProjectInOrg } from '../projects';
import { MAX_IMPORT_FILES } from './content';
import { RemoteAssetMigrator } from './ghost-assets';
import { encodeMarkdownUrl, resolveGitBookRepoPath, rewriteGitBookImages } from './gitbook-assets';
import {
  ensureGitBookReadme,
  findGitBookSpace,
  type GitBookNavNode,
  type GitBookSection,
  inferGitBookNavigation,
  mapGitBookRedirects,
  type PlannedGitBookNode,
  parseGitBookConfig,
  parseGitBookSummary,
  planGitBookNavigation,
} from './gitbook-mapping';
import {
  convertGitBookMarkdown,
  expandGitBookIncludes,
  extractGitBookTitle,
  findGitBookSpaceLinks,
  parseGitBookFrontmatter,
} from './gitbook-markdown';
import { getGitHubDefaultBranch, getGitHubTextFile, githubRawUrl, listGitHubFiles } from './github';
import { rewriteMintlifyInternalLinks } from './mintlify-links';
import { defaultImportTarget, ensureGroupPage, type ImportTarget, removeImportPlaceholders, upsertPage } from './persistence';
import { emptySummary, type ImporterSource, type ImportSummary } from './types';

/**
 * GitBook importer: pull a public GitBook Git Sync repository from GitHub.
 * `.gitbook.yaml` locates the space (root, README, SUMMARY.md, redirects);
 * SUMMARY.md sections become virtual nav categories (GitBook sections never
 * change URLs), nested entries become nested pages, GitBook blocks are mapped
 * onto Nibleaf components, reusable content is inlined, and `.gitbook/assets`
 * images are copied into project storage.
 */
export const gitbookImporter: ImporterSource<GitbookImportBody> = {
  id: 'gitbook',

  async run({ organizationId, projectId, input }): Promise<ImportSummary> {
    const project = await assertProjectInOrg(organizationId, projectId);

    const [owner, name] = input.repo.split('/');
    if (!owner || !name) {
      throw badRequest('Use the form owner/repo.');
    }
    const branch = input.branch?.trim() || (await getGitHubDefaultBranch(owner, name));
    const tree = await listGitHubFiles(owner, name, branch);
    const paths = tree.filter((item) => item.type === 'blob').map((item) => item.path);
    const blobs = new Set(paths);
    const textCache = new Map<string, Promise<string | null>>();
    const loadText = (filePath: string) => {
      const cached = textCache.get(filePath);
      if (cached) return cached;
      const pending = getGitHubTextFile(owner, name, branch, filePath);
      textCache.set(filePath, pending);
      return pending;
    };

    const requestedPath = input.path?.trim().replace(/^\/+|\/+$/g, '') ?? '';
    const space = findGitBookSpace(paths, requestedPath);
    if (!space) {
      throw badRequest('The folder path must stay inside the repository.');
    }
    const summary = emptySummary();
    const { config, warnings: configWarnings } = parseGitBookConfig(
      space.configPath ? await loadText(space.configPath) : null,
      space.configPath,
      space.directory,
    );
    summary.warnings.push(...configWarnings);
    const repoPath = (rootRelative: string) => (config.root ? `${config.root}/${rootRelative}` : rootRelative);
    const rootRelative = new Set(
      paths.flatMap((path) => (!config.root ? [path] : path.startsWith(`${config.root}/`) ? [path.slice(config.root.length + 1)] : [])),
    );

    let sections: GitBookSection[];
    const summaryFile = repoPath(config.summary);
    const rawSummary = blobs.has(summaryFile) ? await loadText(summaryFile) : null;
    if (rawSummary !== null) {
      const parsed = parseGitBookSummary(rawSummary, config.summary);
      summary.warnings.push(...parsed.warnings);
      sections = parsed.sections.map((section) => ({ ...section, nodes: dropMissing(section.nodes, rootRelative, summary) }));
    } else {
      sections = inferGitBookNavigation(paths, config.root, config.readme, config.summary);
      if (sections.length > 0) summary.warnings.push(`No ${config.summary} found — navigation was inferred from folders and file names.`);
    }
    sections = ensureGitBookReadme(sections, config.readme, rootRelative.has(config.readme));
    if (sections.length === 0) {
      throw badRequest(
        space.configPath || requestedPath
          ? 'No Markdown pages were found for this GitBook space.'
          : 'No .gitbook.yaml, SUMMARY.md, or Markdown pages found — is this a GitBook Git Sync repository?',
      );
    }
    const { nodes: planned, routes: plannedRoutes, warnings: planWarnings } = planGitBookNavigation(sections, config.readme);
    summary.warnings.push(...planWarnings);
    const nodes = await loadNodes(planned, { repoPath, loadText, summary, state: { pages: 0, capWarned: false } });
    const routes = importedRoutes(plannedRoutes, nodes);

    const replacementBranch = await createImportReplacementBranch(projectId, 'gitbook', input.replaceExisting !== true);
    try {
      const currentTarget = await defaultImportTarget(projectId);
      const target = { ...currentTarget, branchId: replacementBranch.id };
      const removedPlaceholders = await removeImportPlaceholders(target);
      if (removedPlaceholders > 0) {
        summary.warnings.push(`Removed ${removedPlaceholders} untouched starter placeholder page${removedPlaceholders === 1 ? '' : 's'}.`);
      }
      const assets = new RemoteAssetMigrator(projectId, 'gitbook');
      const context: ImportContext = {
        repo: { owner, name, branch, loadText },
        blobs,
        root: config.root,
        routes,
        labelsFromSummary: rawSummary !== null,
        assets,
        summary,
      };
      await importNodes(nodes, null, target, context);

      summary.assetsImported = assets.migrated;
      summary.assetsSkipped = assets.skipped;
      if (assets.skipped > 0) {
        const reasons = assets.failureReasons();
        summary.warnings.push(
          `${assets.skipped} GitBook image(s) could not be copied into project storage${reasons ? ` (${reasons})` : ''}. Their source references were preserved.`,
        );
      }

      // `.gitbook.yaml` redirects fill the project's redirects only when it has none.
      let replacementConfig: Prisma.InputJsonValue | undefined;
      if (config.redirects.length > 0) {
        const mapped = mapGitBookRedirects(config.redirects, routes);
        summary.warnings.push(...mapped.warnings);
        const existing = (project.config as ProjectConfig | null) ?? {};
        const redirects = mapped.redirects.slice(0, MAX_REDIRECT_RULES);
        if (mapped.redirects.length > MAX_REDIRECT_RULES) {
          summary.warnings.push(`Only the first ${MAX_REDIRECT_RULES} redirects were imported.`);
        }
        if ((existing.redirects?.length ?? 0) > 0) {
          summary.warnings.push('Kept your existing redirects; redirects from .gitbook.yaml were not applied.');
        } else if (redirects.length > 0) {
          const issues = validateRedirectGraph(redirects).issues;
          if (issues.length > 0) {
            summary.warnings.push(`Redirects from .gitbook.yaml were not applied: ${issues[0]?.message ?? 'they are invalid'}`);
          } else {
            replacementConfig = { ...existing, redirects } as Prisma.InputJsonValue;
            summary.warnings.push(`Applied ${redirects.length} redirect${redirects.length === 1 ? '' : 's'} from .gitbook.yaml.`);
          }
        }
      }

      await promoteImportReplacementBranch(projectId, replacementBranch.id, replacementConfig);
      summary.warnings.push('Replaced the existing draft navigation only after the complete GitBook import succeeded.');
      return summary;
    } catch (error) {
      await prisma.branch.deleteMany({ where: { id: replacementBranch.id, projectId, isDefault: false } }).catch(() => undefined);
      throw error;
    }
  },
};

interface ImportContext {
  repo: { owner: string; name: string; branch: string; loadText(filePath: string): Promise<string | null> };
  blobs: ReadonlySet<string>;
  /** Space root directory in the repository ('' = repo root). */
  root: string;
  routes: ReadonlyMap<string, string>;
  /** False when navigation was inferred: generated titles must not become sidebar labels. */
  labelsFromSummary: boolean;
  assets: RemoteAssetMigrator;
  summary: ImportSummary;
}

interface LoadContext {
  repoPath(rootRelative: string): string;
  loadText(filePath: string): Promise<string | null>;
  summary: ImportSummary;
  state: { pages: number; capWarned: boolean };
}

/** A planned node that will be created; pages carry their downloaded source. */
interface LoadedGitBookNode {
  node: PlannedGitBookNode;
  page?: { path: string; filePath: string; raw: string };
  children: LoadedGitBookNode[];
}

/**
 * Depth-first download of the planned tree in import order. Pages that fail to
 * download (with their children) and nodes past the cap are dropped here, so
 * routes, links, and redirects only ever target pages that get imported.
 */
const loadNodes = async (nodes: readonly PlannedGitBookNode[], context: LoadContext): Promise<LoadedGitBookNode[]> => {
  const { summary, state } = context;
  const loaded: LoadedGitBookNode[] = [];
  for (const node of nodes) {
    // The cap bounds every CREATED node — groups included.
    if (state.pages >= MAX_IMPORT_FILES) {
      if (!state.capWarned) {
        summary.warnings.push(`Import capped at ${MAX_IMPORT_FILES} pages — remaining navigation entries were skipped.`);
        state.capWarned = true;
      }
      summary.skipped++;
      continue;
    }

    if (node.kind === 'group' || !node.path) {
      state.pages++;
      loaded.push({ node, children: await loadNodes(node.children, context) });
      continue;
    }

    const filePath = context.repoPath(node.path);
    const raw = await context.loadText(filePath);
    if (raw === null) {
      summary.warnings.push(`Could not download "${filePath}" — the page and its children were skipped.`);
      summary.skipped++;
      continue;
    }
    state.pages++;
    loaded.push({ node, page: { path: node.path, filePath, raw }, children: await loadNodes(node.children, context) });
  }
  return loaded;
};

/** Planned routes narrowed to the pages that will be imported. */
const importedRoutes = (routes: ReadonlyMap<string, string>, nodes: readonly LoadedGitBookNode[]): Map<string, string> => {
  const kept = new Set<string>();
  const visit = (items: readonly LoadedGitBookNode[]) => {
    for (const item of items) {
      if (item.page) kept.add(item.node.route);
      visit(item.children);
    }
  };
  visit(nodes);
  return new Map([...routes].filter(([, route]) => kept.has(route)));
};

/** SUMMARY.md entries whose file is absent are skipped; their children move up. */
const dropMissing = (nodes: readonly GitBookNavNode[], files: ReadonlySet<string>, summary: ImportSummary): GitBookNavNode[] =>
  nodes.flatMap((node) => {
    const children = dropMissing(node.children, files, summary);
    if (node.kind === 'group' || files.has(node.path)) return [{ ...node, children }];
    summary.warnings.push(`SUMMARY.md page "${node.path}" was not found in the repository.`);
    summary.skipped++;
    return children;
  });

/** Depth-first import of the loaded tree; the array index is the sibling position. */
const importNodes = async (
  nodes: readonly LoadedGitBookNode[],
  parentId: string | null,
  target: ImportTarget,
  context: ImportContext,
): Promise<void> => {
  const { summary } = context;
  for (const [position, { node, page, children }] of nodes.entries()) {
    if (!page) {
      const groupId = await ensureGroupPage(target, { parentId, title: node.title.slice(0, 200), slug: node.slug, position });
      await importNodes(children, groupId, target, context);
      continue;
    }

    const { path, filePath, raw } = page;
    const { meta, body: rawBody } = parseGitBookFrontmatter(raw);
    const { title: heading, body } = extractGitBookTitle(rawBody);
    const resolve = (reference: string, sourceFile: string) => resolveGitBookRepoPath(reference, sourceFile, context.blobs, context.root);
    const includeWarnings: string[] = [];
    const expanded = await expandGitBookIncludes(body, filePath, resolve, context.repo.loadText, includeWarnings);
    summary.warnings.push(...includeWarnings);

    const rawUrl = (repoFile: string) => githubRawUrl(context.repo.owner, context.repo.name, context.repo.branch, repoFile);
    const converted = convertGitBookMarkdown(expanded, {
      resolveFile: (reference) => {
        if (/^https?:\/\//i.test(reference)) return reference;
        const resolved = resolve(reference, filePath);
        return resolved ? encodeMarkdownUrl(rawUrl(resolved)) : undefined;
      },
    });
    summary.warnings.push(...converted.warnings.map((warning) => `${path}: ${warning}`));
    const linked = rewriteMintlifyInternalLinks(converted.content, path, context.routes);
    const spaceLinks = findGitBookSpaceLinks(linked);
    if (spaceLinks.length > 0) {
      summary.warnings.push(
        `Page "${path}" links to another GitBook space (${spaceLinks.length} link${spaceLinks.length === 1 ? '' : 's'}) — kept as-is, point ${spaceLinks.length === 1 ? 'it' : 'them'} at the published page: ${spaceLinks.slice(0, 3).join(', ')}.`,
      );
    }
    const images = rewriteGitBookImages(linked, filePath, context.blobs, context.root, rawUrl);
    if (images.missing.length > 0) {
      summary.warnings.push(
        `Page "${path}" references ${images.missing.length} image${images.missing.length === 1 ? '' : 's'} not found in the repository: ${images.missing.slice(0, 3).join(', ')}.`,
      );
    }
    const content = await context.assets.rewrite(images.content);

    // GitBook's page title is the file's H1; the SUMMARY text (or its explicit
    // link title) is the sidebar label when it differs.
    const title = (heading ?? node.title).slice(0, 200);
    const sidebarTitle = node.label ?? (context.labelsFromSummary && heading && heading !== node.title ? node.title : undefined);
    const config: PageConfig = {
      ...(sidebarTitle ? { sidebarTitle: sidebarTitle.slice(0, 120) } : {}),
      ...(node.category ? { category: node.category, categoryOrder: node.categoryOrder ?? 0 } : {}),
      ...(meta.mode ? { mode: meta.mode } : {}),
      ...(meta.hideToc ? { hideToc: true } : {}),
    };
    const { outcome, id } = await upsertPage(target, {
      parentId,
      slug: node.slug,
      title,
      content,
      ...(meta.description ? { description: meta.description.slice(0, 500) } : {}),
      ...(meta.icon ? { icon: meta.icon.slice(0, 64) } : {}),
      ...(Object.keys(config).length > 0 ? { config } : {}),
      hidden: meta.hidden === true,
      position,
    });
    summary[outcome === 'imported' ? 'imported' : 'updated']++;
    await importNodes(children, id, target, context);
  }
};
