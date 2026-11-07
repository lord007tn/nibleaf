import { execFile } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { prisma } from '@nibleaf/database';
import { slugify, slugifyUnicode } from '@nibleaf/shared/utils';
import type { GitConfig } from '@nibleaf/validators';
import got from 'got';
import { z } from 'zod';
import { badRequest } from '@/errors';
import { isPrivateIp } from '@/lib/client-ip';
import { assertBranchInProject, getDefaultBranch } from './branches';
import { deriveTitle, humanize, MAX_IMPORT_FILES, parseFrontmatter } from './importers/content';
import { getGitHubTextFile, listGitHubFiles } from './importers/github';
import { ensureGroupPage, type ImportTarget } from './importers/persistence';
import { assertLanguageInProject, getDefaultLanguage } from './languages';
import { createPage } from './pages';
import { assertProjectInOrg } from './projects';

const execFileAsync = promisify(execFile);

interface MarkdownFile {
  path: string;
  read: () => Promise<string | null>;
}

export interface GitImportSummary {
  files: number;
  imported: number;
  updated: number;
  skipped: number;
}

const normalizeRemoteUrl = (value: string, label: string): URL => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw badRequest(`Enter a valid ${label}.`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw badRequest(`${label} must use http(s).`);
  }
  if (url.username || url.password) {
    throw badRequest(`${label} must not include embedded credentials.`);
  }
  return url;
};

const assertPublicRemoteUrl = async (value: string, label: string): Promise<URL> => {
  const url = normalizeRemoteUrl(value, label);
  try {
    const records = await lookup(url.hostname, { all: true, verbatim: true });
    if (records.length === 0 || records.some((record) => isPrivateIp(record.address))) {
      throw badRequest(`${label} must resolve to a public host.`);
    }
  } catch (error) {
    if (error instanceof Error && error.message === `${label} must resolve to a public host.`) {
      throw error;
    }
    throw badRequest(`${label} could not be resolved. Check the hostname and try again.`);
  }
  return url;
};

const fetchGitLab = async (url: URL | string) => {
  try {
    const response = await got(url, {
      headers: { 'User-Agent': 'nibleaf' },
      followRedirect: false,
      retry: { limit: 0 },
      throwHttpErrors: false,
    });
    if (response.statusCode >= 300 && response.statusCode < 400) throw new Error('redirect rejected');
    return response;
  } catch {
    throw badRequest('Could not reach the public GitLab instance without following a redirect. Check its URL and availability.');
  }
};

const normalizeInstanceUrl = (value?: string): string => {
  const raw = value?.trim() || 'https://gitlab.com';
  const url = normalizeRemoteUrl(raw, 'GitLab instance URL');
  url.pathname = url.pathname.replace(/\/+$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/+$/, '');
};

/** Normalize a repository-relative content directory and reject anything that
 * could escape the temporary clone. This runs even for settings written before
 * the validator gained the same restriction. */
export const normalizeGitContentPath = (value?: string): string => {
  const raw = value?.trim() ?? '';
  if (!raw) {
    return '';
  }
  const slashPath = raw.replace(/\\/g, '/');
  const parts = slashPath.split('/').filter(Boolean);
  if (slashPath.startsWith('/') || /^[A-Za-z]:/.test(slashPath) || parts.some((part) => part === '.' || part === '..')) {
    throw badRequest('Git content path must stay inside the repository.');
  }
  return parts.join('/');
};

const listGitLabFiles = async (
  projectPath: string,
  branch: string,
  basePath: string,
  instanceUrl?: string,
): Promise<Array<{ path: string; type: 'blob' | 'tree' }>> => {
  const base = normalizeInstanceUrl(instanceUrl);
  const project = encodeURIComponent(projectPath);
  const files: Array<{ path: string; type: 'blob' | 'tree' }> = [];
  let page = 1;

  while (files.length < MAX_IMPORT_FILES) {
    const url = new URL(`${base}/api/v4/projects/${project}/repository/tree`);
    url.searchParams.set('ref', branch);
    url.searchParams.set('recursive', 'true');
    url.searchParams.set('per_page', '100');
    url.searchParams.set('page', String(page));
    if (basePath) {
      url.searchParams.set('path', basePath);
    }

    const res = await fetchGitLab(url);
    if (!res.ok) {
      throw badRequest(
        res.statusCode === 404
          ? 'Project, branch, or path not found. Imports support public GitLab repositories only.'
          : `GitLab API error (${res.statusCode}). Try again shortly.`,
      );
    }
    const chunk = z.array(z.object({ path: z.string(), type: z.enum(['blob', 'tree']) })).parse(JSON.parse(res.body));
    files.push(...chunk.map((item) => ({ path: item.path, type: item.type })));

    if (chunk.length < 100) {
      break;
    }
    page++;
  }

  return files;
};

const gitLabRawFileUrl = (repo: string, branch: string, filePath: string, instanceUrl?: string) => {
  const base = normalizeInstanceUrl(instanceUrl);
  const url = new URL(`${base}/api/v4/projects/${encodeURIComponent(repo)}/repository/files/${encodeURIComponent(filePath)}/raw`);
  url.searchParams.set('ref', branch);
  return url.toString();
};

const assertSafeCloneUrl = async (value: string): Promise<string> => {
  const url = await assertPublicRemoteUrl(value, 'Public Git URL');
  url.hash = '';
  return url.toString();
};

const walkMarkdownFiles = async (root: string, rel = '', found: string[] = []): Promise<string[]> => {
  const entries = await readdir(path.join(root, rel), { withFileTypes: true });
  for (const entry of entries) {
    if (found.length >= MAX_IMPORT_FILES) {
      return found;
    }
    if (entry.name === '.git') {
      continue;
    }
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await walkMarkdownFiles(root, child, found);
    } else if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.mdx'))) {
      found.push(child);
    }
  }
  return found;
};

const listGenericGitFiles = async (cloneUrl: string, branch: string, basePath: string): Promise<MarkdownFile[]> => {
  const safeUrl = await assertSafeCloneUrl(cloneUrl);
  const dir = await mkdtemp(path.join(tmpdir(), 'nibleaf-git-'));
  try {
    await execFileAsync('git', ['clone', '--depth=1', '--single-branch', '--branch', branch, '--no-tags', safeUrl, dir], {
      timeout: 60_000,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_CONFIG_COUNT: '3',
        GIT_CONFIG_KEY_0: 'protocol.file.allow',
        GIT_CONFIG_VALUE_0: 'never',
        GIT_CONFIG_KEY_1: 'protocol.ssh.allow',
        GIT_CONFIG_VALUE_1: 'never',
        GIT_CONFIG_KEY_2: 'http.followRedirects',
        GIT_CONFIG_VALUE_2: 'false',
      },
    });
    const contentRoot = basePath ? path.resolve(dir, basePath) : dir;
    const cloneRoot = path.resolve(dir);
    if (contentRoot !== cloneRoot && !contentRoot.startsWith(`${cloneRoot}${path.sep}`)) {
      throw badRequest('Git content path must stay inside the repository.');
    }
    const files = await walkMarkdownFiles(contentRoot);
    const loaded = await Promise.all(
      files.map(async (file) => ({
        path: basePath ? `${basePath}/${file}` : file,
        content: await readFile(path.join(contentRoot, file), 'utf8'),
      })),
    );
    return loaded.map((file) => ({ path: file.path, read: async () => file.content }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw badRequest('Git is not installed in this Nibleaf runtime.');
    }
    throw badRequest('Could not clone the public Git repository. Check the URL, branch, and path.');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

/** Where one repository file lands: the folder (`dir`, repo-relative) whose
 * page group it joins and the name its slug derives from. `dir/index.md` and
 * `dir/README.md` stand for the folder itself, one level up. */
const importFileLocation = (relativePath: string): { dir: string; name: string } => {
  const segments = relativePath.split('/');
  const fileBase = (segments.pop() ?? '').replace(/\.(md|mdx)$/i, '');
  const relDir = segments.join('/');
  if (!/^(index|readme)$/i.test(fileBase)) return { dir: relDir, name: fileBase };
  return { dir: relDir.split('/').slice(0, -1).join('/'), name: relDir.split('/').filter(Boolean).pop() ?? fileBase };
};

/**
 * Each Git-imported page is linked to the repository file it came from by a
 * `PageGitImportSource` row (one path ↔ one page per branch/language). Re-imports
 * match files to pages through that row, never by position in a list of
 * look-alike names, so adding, renaming or removing a sibling (`Intro.md` next
 * to `intro.md`) cannot move one file's text onto another file's page. The row
 * is server-only: page settings, tree edits and published snapshots never see
 * it, and it is deleted with its page.
 */
type ScopePage = { id: string; parentId: string | null; kind: 'PAGE' | 'GROUP'; slug: string };

/**
 * Pages imported before identities existed have no source row. Adopt such a
 * page only when it sits where this file's earlier import put it: its Unicode
 * slug, the older ASCII-only slug (`café.md` → `caf`), or that slug's `-2` when
 * a folder group took the plain slug first. A page that already belongs to
 * another path is never taken.
 *
 * The older importer gave every name without ASCII letters (all Arabic names)
 * the slug `page`, so those files also try `page` / `page-2`. Several files
 * collapsed onto that one page, so it is adopted only by the file whose text
 * it holds exactly (`exactOnly`).
 */
const legacyImportedPage = (
  siblings: readonly ScopePage[],
  name: string,
  isAvailable: (page: ScopePage) => boolean,
): { page: ScopePage; exactOnly: boolean } | null => {
  const ascii = slugify(name);
  const candidates = [...new Set([slugifyUnicode(name), ascii].filter(Boolean))].map((slug) => ({ slug, exactOnly: false }));
  if (!ascii) candidates.push({ slug: 'page', exactOnly: true });
  for (const { slug, exactOnly } of candidates) {
    const options = siblings.some((page) => page.kind === 'GROUP' && page.slug === slug) ? [slug, `${slug}-2`] : [slug];
    for (const option of options) {
      const page = siblings.find((candidate) => candidate.kind === 'PAGE' && candidate.slug === option && isAvailable(candidate));
      if (page) return { page, exactOnly };
    }
  }
  return null;
};

const isUniqueViolation = (error: unknown) => typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';

/**
 * One-way import: pull Markdown/MDX files from a PUBLIC Git source (the configured
 * repo/branch/path on the project's org) into a configured or default branch/language,
 * recreating the folder structure as page groups. Idempotent — re-importing updates a
 * page in place (matched by its source file, see PageGitImportSource) instead of duplicating it. Public GitHub,
 * GitLab, and generic http(s) Git repositories are supported; private/OAuth/webhook/
 * two-way sync is intentionally outside this import path.
 */
export const importFromGitProvider = async (organizationId: string, projectId: string): Promise<GitImportSummary> => {
  await assertProjectInOrg(organizationId, projectId);

  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { metadata: true } });
  const metadata = org?.metadata ? (JSON.parse(org.metadata) as Record<string, unknown>) : {};
  const git = (metadata.git ?? {}) as GitConfig;
  const provider = git.provider ?? 'github';
  if (provider !== 'github' && provider !== 'gitlab' && provider !== 'git') {
    throw badRequest('Connect a public Git repository first.');
  }
  const branch = git.branch?.trim() || 'main';
  const basePath = normalizeGitContentPath(git.path);
  const prefix = basePath ? `${basePath}/` : '';
  const safeGitLabInstance =
    provider === 'gitlab'
      ? normalizeInstanceUrl((await assertPublicRemoteUrl(git.instanceUrl?.trim() || 'https://gitlab.com', 'GitLab instance URL')).toString())
      : undefined;

  let mdFiles: MarkdownFile[];
  if (provider === 'git') {
    if (!git.cloneUrl) {
      throw badRequest('Connect a public Git clone URL first.');
    }
    mdFiles = await listGenericGitFiles(git.cloneUrl, branch, basePath);
  } else {
    const repo = git.repo;
    if (!repo?.includes('/')) {
      throw badRequest('Connect a public GitHub or GitLab repository first.');
    }
    if (provider === 'github' && repo.split('/').length !== 2) {
      throw badRequest('GitHub repositories must use owner/repo.');
    }
    const tree =
      provider === 'github'
        ? await listGitHubFiles(repo.split('/')[0] as string, repo.split('/')[1] as string, branch)
        : await listGitLabFiles(repo, branch, basePath, safeGitLabInstance);
    mdFiles = tree
      .filter((i) => i.type === 'blob' && (i.path.endsWith('.md') || i.path.endsWith('.mdx')) && i.path.startsWith(prefix))
      .slice(0, MAX_IMPORT_FILES)
      .map((file) => ({
        path: file.path,
        read: async () => {
          if (provider === 'github') {
            const [owner, name] = repo.split('/');
            return getGitHubTextFile(owner as string, name as string, branch, file.path);
          }
          const response = await fetchGitLab(gitLabRawFileUrl(repo, branch, file.path, safeGitLabInstance));
          return response.ok ? response.body : null;
        },
      }));
  }
  if (mdFiles.length === 0) {
    throw badRequest('No Markdown (.md/.mdx) files found at that repo path.');
  }

  const branchRow = git.importBranchId ? await assertBranchInProject(projectId, git.importBranchId) : await getDefaultBranch(projectId);
  const language = git.importLanguageId ? await assertLanguageInProject(projectId, git.importLanguageId) : await getDefaultLanguage(projectId);
  const target: ImportTarget = { projectId, branchId: branchRow.id, languageId: language.id };

  // Cache the GROUP page id per directory so each folder is created once.
  const groupCache = new Map<string, string | null>();
  const ensureGroups = async (relDir: string): Promise<string | null> => {
    if (!relDir) {
      return null;
    }
    const parts = relDir.split('/').filter(Boolean);
    let parentId: string | null = null;
    let cumulative = '';
    for (const part of parts) {
      cumulative = cumulative ? `${cumulative}/${part}` : part;
      const cached = groupCache.get(cumulative);
      if (cached !== undefined) {
        parentId = cached;
        continue;
      }
      const groupId = await ensureGroupPage(target, { parentId, title: humanize(part), slug: slugifyUnicode(part) || 'group' });
      groupCache.set(cumulative, groupId);
      parentId = groupId;
    }
    return parentId;
  };

  const summary: GitImportSummary = { files: mdFiles.length, imported: 0, updated: 0, skipped: 0 };

  // Download every file before writing anything, so a fetch failure part-way
  // through cannot leave a half-imported draft behind.
  const loaded: Array<{ source: string; rel: string; text: string }> = [];
  for (const file of [...mdFiles].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    const text = await file.read();
    if (text === null) {
      summary.skipped++;
      continue;
    }
    loaded.push({ source: file.path, rel: file.path.slice(prefix.length), text });
  }

  const scope = { projectId, branchId: target.branchId, languageId: target.languageId };
  // Identity follows the page: rows are found through the page's CURRENT
  // branch and language, so a page moved by a branch merge or an import
  // promotion keeps its source. Rows whose stored scope went stale are moved
  // onto the page's scope before anything is written, which keeps the unique
  // (branch, language, path) key true to where the page lives.
  const [scopePages, linked] = await Promise.all([
    prisma.page.findMany({ where: scope, select: { id: true, parentId: true, kind: true, slug: true } }) as Promise<ScopePage[]>,
    prisma.pageGitImportSource.findMany({
      where: { projectId, page: { branchId: target.branchId, languageId: target.languageId } },
      orderBy: { createdAt: 'asc' },
      select: { pageId: true, path: true, branchId: true, languageId: true },
    }),
  ]);
  const sources: typeof linked = [];
  for (const source of linked) {
    if (source.branchId === target.branchId && source.languageId === target.languageId) {
      sources.push(source);
      continue;
    }
    try {
      await prisma.pageGitImportSource.update({
        where: { pageId: source.pageId },
        data: { branchId: target.branchId, languageId: target.languageId },
      });
      sources.push(source);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // Another page here already holds this path: that one keeps it.
      await prisma.pageGitImportSource.delete({ where: { pageId: source.pageId } });
    }
  }
  const pageIdBySource = new Map(sources.map((source) => [source.path, source.pageId]));
  const owned = new Set(linked.map((source) => source.pageId));

  type Plan = {
    file: (typeof loaded)[number];
    name: string;
    body: string;
    fields: { title: string; content: string; description?: string; icon?: string };
    parentId: string | null;
    pageId: string | null;
    adopted: boolean;
  };
  const plans: Plan[] = loaded.map((file) => {
    const { meta, body } = parseFrontmatter(file.text);
    const { name } = importFileLocation(file.rel);
    return {
      file,
      name,
      body,
      fields: {
        title: deriveTitle(meta, body, name),
        content: body,
        ...(meta.description ? { description: meta.description.slice(0, 500) } : {}),
        ...(meta.icon ? { icon: meta.icon.slice(0, 64) } : {}),
      },
      parentId: null,
      pageId: pageIdBySource.get(file.source) ?? null,
      adopted: false,
    };
  });

  // Files without a source row: place them and look for the page an older
  // import left for them.
  const contenders = new Map<string, Array<{ plan: Plan; exactOnly: boolean }>>();
  for (const plan of plans) {
    if (plan.pageId) continue;
    plan.parentId = await ensureGroups(importFileLocation(plan.file.rel).dir);
    const siblings = scopePages.filter((page) => page.parentId === plan.parentId);
    const legacy = legacyImportedPage(siblings, plan.name, (page) => !owned.has(page.id));
    if (legacy) contenders.set(legacy.page.id, [...(contenders.get(legacy.page.id) ?? []), { plan, exactOnly: legacy.exactOnly }]);
  }
  if (contenders.size > 0) {
    const stored = await prisma.page.findMany({ where: { id: { in: [...contenders.keys()] } }, select: { id: true, content: true } });
    for (const page of stored) {
      const rivals = contenders.get(page.id) ?? [];
      // Look-alike files (`Intro.md`, `intro.md`) once overwrote one shared
      // page. Keep it with the file whose text it holds, else with the last
      // file in path order — the older importer's last writer — so the text at
      // that URL does not switch files. A `page` fallback needs the exact text.
      const keeper = rivals.find(({ plan }) => plan.body === page.content) ?? rivals.filter(({ exactOnly }) => !exactOnly).at(-1);
      if (keeper) Object.assign(keeper.plan, { pageId: page.id, adopted: true });
    }
  }

  for (const plan of plans) {
    if (plan.pageId) {
      if (plan.adopted) {
        // Claim the page before writing to it: if a concurrent import claimed
        // this path or page first, leave the page to that import.
        try {
          await prisma.pageGitImportSource.create({ data: { ...scope, pageId: plan.pageId, path: plan.file.source } });
        } catch (error) {
          if (!isUniqueViolation(error)) throw error;
          summary.skipped++;
          continue;
        }
      }
      await prisma.page.update({ where: { id: plan.pageId }, data: plan.fields });
      summary.updated++;
      continue;
    }
    // A new file always gets a new page; createPage picks a slug no sibling
    // (page or folder group) uses yet, and the source row keeps it stable.
    const created = await createPage(projectId, {
      ...plan.fields,
      slug: slugifyUnicode(plan.name) || 'page',
      parentId: plan.parentId,
      branchId: target.branchId,
      languageId: target.languageId,
    });
    try {
      await prisma.pageGitImportSource.create({ data: { ...scope, pageId: created.id, path: plan.file.source } });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // A concurrent import created this file's page first: drop the duplicate
      // instead of leaving a page no import will ever update — but only while
      // it is still exactly what this import wrote. A writer may already have
      // saved it or added a page, comment or grant under it (all of which a
      // delete would take with it); then it stays, simply unlinked. A deletion
      // is a structural write: project lock first, then the page row, as the
      // page-write protocol requires.
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM "project" WHERE "id" = ${projectId} FOR NO KEY UPDATE`;
        await tx.$queryRaw`SELECT "id" FROM "page" WHERE "id" = ${created.id} FOR UPDATE`;
        const untouched = await tx.page.findFirst({
          where: {
            id: created.id,
            projectId,
            updatedAt: created.updatedAt,
            title: created.title,
            content: created.content,
            description: created.description,
            icon: created.icon,
            children: { none: {} },
            comments: { none: {} },
            audienceGrants: { none: {} },
          },
          select: { id: true },
        });
        if (untouched) await tx.page.deleteMany({ where: { id: created.id, projectId } });
      });
      summary.skipped++;
      continue;
    }
    summary.imported++;
  }

  // Record that this repo is connected + when it last imported.
  metadata.git = { ...git, connected: true, lastImportedAt: new Date().toISOString() };
  await prisma.organization.update({ where: { id: organizationId }, data: { metadata: JSON.stringify(metadata) } });

  return summary;
};
