import { execFile } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { prisma } from '@nibleaf/database';
import { slugify } from '@nibleaf/shared';
import type { GitConfig } from '@nibleaf/validators';
import { badRequest } from '@/errors';
import { isPrivateIp } from '@/lib/client-ip';
import { assertBranchInProject, getDefaultBranch } from './branches';
import { deriveTitle, humanize, MAX_IMPORT_FILES, parseFrontmatter } from './importers/content';
import { githubRawUrl, listGitHubFiles } from './importers/github';
import { ensureGroupPage, type ImportTarget, upsertLeafPage } from './importers/persistence';
import { assertLanguageInProject, getDefaultLanguage } from './languages';
import { assertProjectInOrg } from './projects';

type GitProvider = NonNullable<GitConfig['provider']>;
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

/** Hard cap so an accidental import of a huge repo can't fan out unbounded. */
const MAX_FILES = MAX_IMPORT_FILES;

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

const fetchGitLab = async (url: URL | string): Promise<Response> => {
  try {
    return await fetch(url, {
      headers: { 'User-Agent': 'nibleaf' },
      // A custom GitLab host is user-controlled. Following a redirect could
      // bypass the public-host DNS check above and reach an internal service.
      redirect: 'error',
    });
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

  while (files.length < MAX_FILES) {
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
        res.status === 404
          ? 'Project, branch, or path not found. Imports support public GitLab repositories only.'
          : `GitLab API error (${res.status}). Try again shortly.`,
      );
    }
    const chunk = (await res.json()) as Array<{ path: string; type: 'blob' | 'tree' }>;
    files.push(...chunk.map((item) => ({ path: item.path, type: item.type })));

    if (chunk.length < 100) {
      break;
    }
    page++;
  }

  return files;
};

const rawFileUrl = (provider: GitProvider, repo: string, branch: string, filePath: string, instanceUrl?: string): string => {
  if (provider === 'github') {
    const [owner, name] = repo.split('/');
    return githubRawUrl(owner ?? '', name ?? '', branch, filePath);
  }

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
    if (found.length >= MAX_FILES) {
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

/**
 * One-way import: pull Markdown/MDX files from a PUBLIC Git source (the configured
 * repo/branch/path on the project's org) into a configured or default branch/language,
 * recreating the folder structure as page groups. Idempotent — re-importing updates a
 * page in place (matched by parent + slug) instead of duplicating it. Public GitHub,
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
      .slice(0, MAX_FILES)
      .map((file) => ({
        path: file.path,
        read: async () => {
          const rawUrl = rawFileUrl(provider, repo, branch, file.path, safeGitLabInstance);
          const rawRes =
            provider === 'gitlab'
              ? await fetchGitLab(rawUrl)
              : await fetch(rawUrl, {
                  headers: { 'User-Agent': 'nibleaf' },
                });
          return rawRes.ok ? rawRes.text() : null;
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
      const groupId = await ensureGroupPage(target, { parentId, title: humanize(part), slug: slugify(part) });
      groupCache.set(cumulative, groupId);
      parentId = groupId;
    }
    return parentId;
  };

  const summary: GitImportSummary = { files: mdFiles.length, imported: 0, updated: 0, skipped: 0 };

  for (const file of mdFiles) {
    const text = await file.read();
    if (text === null) {
      summary.skipped++;
      continue;
    }
    const { meta, body } = parseFrontmatter(text);

    const rel = file.path.slice(prefix.length);
    const segments = rel.split('/');
    const fileBase = (segments.pop() ?? '').replace(/\.(md|mdx)$/i, '');
    const relDir = segments.join('/');
    const isFolderIndex = /^(index|readme)$/i.test(fileBase);

    // `dir/index.md` / `dir/README.md` represent the folder itself → live one level up
    // with the folder's name; everything else is a leaf inside its directory.
    const folderName = relDir.split('/').filter(Boolean).pop() ?? fileBase;
    const targetDir = isFolderIndex ? relDir.split('/').slice(0, -1).join('/') : relDir;
    const nameForSlug = isFolderIndex ? folderName : fileBase;
    const slug = slugify(nameForSlug) || 'page';
    const parentId = await ensureGroups(targetDir);
    const title = deriveTitle(meta, body, nameForSlug);

    const outcome = await upsertLeafPage(target, {
      parentId,
      slug,
      title,
      content: body,
      ...(meta.description ? { description: meta.description.slice(0, 500) } : {}),
      ...(meta.icon ? { icon: meta.icon.slice(0, 64) } : {}),
    });
    summary[outcome === 'imported' ? 'imported' : 'updated']++;
  }

  // Record that this repo is connected + when it last imported.
  metadata.git = { ...git, connected: true, lastImportedAt: new Date().toISOString() };
  await prisma.organization.update({ where: { id: organizationId }, data: { metadata: JSON.stringify(metadata) } });

  return summary;
};
