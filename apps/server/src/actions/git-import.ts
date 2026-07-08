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
import { assertBranchInProject, ensureDefaultBranch } from './branches';
import { assertLanguageInProject, ensureDefaultLanguage } from './languages';
import { createPage } from './pages';
import { assertProjectInOrg } from './projects';

type GitProvider = NonNullable<GitConfig['provider']>;
const execFileAsync = promisify(execFile);

interface GitTreeItem {
  path: string;
  type: 'blob' | 'tree';
}

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
const MAX_FILES = 250;

/** Minimal YAML-frontmatter reader: enough for `title`/`sidebarTitle`/`description`/`icon`. */
function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match?.[1]) {
    return { meta: {}, body: raw };
  }
  const meta: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv?.[1]) {
      let value = (kv[2] ?? '').trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      meta[kv[1].toLowerCase()] = value;
    }
  }
  return { meta, body: raw.slice(match[0].length) };
}

const humanize = (name: string): string =>
  name
    .replace(/[-_]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase()) || 'Untitled';

function deriveTitle(meta: Record<string, string>, body: string, fallbackName: string): string {
  if (meta.title) {
    return meta.title.slice(0, 200);
  }
  if (meta.sidebartitle) {
    return meta.sidebartitle.slice(0, 200);
  }
  const h1 = body.match(/^#\s+(.+)$/m);
  if (h1?.[1]) {
    return h1[1].trim().slice(0, 200);
  }
  return humanize(fallbackName);
}

const normalizeInstanceUrl = (value?: string): string => {
  const raw = value?.trim() || 'https://gitlab.com';
  const url = new URL(raw);
  url.pathname = url.pathname.replace(/\/+$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/+$/, '');
};

const listGitHubFiles = async (owner: string, repo: string, branch: string): Promise<GitTreeItem[]> => {
  const treeRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'nibleaf-docs' },
  });
  if (!treeRes.ok) {
    throw badRequest(
      treeRes.status === 404
        ? 'Repository or branch not found. Imports support public GitHub repositories only.'
        : `GitHub API error (${treeRes.status}). Try again shortly.`,
    );
  }
  const tree = (await treeRes.json()) as { tree?: GitTreeItem[] };
  return tree.tree ?? [];
};

const listGitLabFiles = async (projectPath: string, branch: string, basePath: string, instanceUrl?: string): Promise<GitTreeItem[]> => {
  const base = normalizeInstanceUrl(instanceUrl);
  const project = encodeURIComponent(projectPath);
  const files: GitTreeItem[] = [];
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

    const res = await fetch(url, { headers: { 'User-Agent': 'nibleaf-docs' } });
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
    return `https://raw.githubusercontent.com/${owner}/${name}/${encodeURIComponent(branch)}/${filePath.split('/').map(encodeURIComponent).join('/')}`;
  }

  const base = normalizeInstanceUrl(instanceUrl);
  const url = new URL(`${base}/api/v4/projects/${encodeURIComponent(repo)}/repository/files/${encodeURIComponent(filePath)}/raw`);
  url.searchParams.set('ref', branch);
  return url.toString();
};

const isPrivateIp = (address: string): boolean =>
  /^(?:10\.|127\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.|0\.|::1$|fc00:|fd00:|fe80:)/i.test(address);

const assertSafeCloneUrl = async (value: string): Promise<string> => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw badRequest('Enter a valid public Git URL.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw badRequest('Public Git URL imports only support http(s) clone URLs.');
  }
  if (url.username || url.password) {
    throw badRequest('Public Git URL imports do not accept embedded credentials.');
  }
  if (process.env.ALLOW_PRIVATE_GIT_IMPORTS !== 'true') {
    const records = await lookup(url.hostname, { all: true, verbatim: true });
    if (records.length === 0 || records.some((record) => isPrivateIp(record.address))) {
      throw badRequest('Public Git URL imports must resolve to a public host.');
    }
  }
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
        GIT_CONFIG_COUNT: '2',
        GIT_CONFIG_KEY_0: 'protocol.file.allow',
        GIT_CONFIG_VALUE_0: 'never',
        GIT_CONFIG_KEY_1: 'protocol.ssh.allow',
        GIT_CONFIG_VALUE_1: 'never',
      },
    });
    const contentRoot = basePath ? path.join(dir, basePath) : dir;
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
  const basePath = (git.path ?? '').replace(/^\/+|\/+$/g, '');
  const prefix = basePath ? `${basePath}/` : '';

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
        : await listGitLabFiles(repo, branch, basePath, git.instanceUrl);
    mdFiles = tree
      .filter((i) => i.type === 'blob' && (i.path.endsWith('.md') || i.path.endsWith('.mdx')) && i.path.startsWith(prefix))
      .slice(0, MAX_FILES)
      .map((file) => ({
        path: file.path,
        read: async () => {
          const rawRes = await fetch(rawFileUrl(provider, repo, branch, file.path, git.instanceUrl), {
            headers: { 'User-Agent': 'nibleaf-docs' },
          });
          return rawRes.ok ? rawRes.text() : null;
        },
      }));
  }
  if (mdFiles.length === 0) {
    throw badRequest('No Markdown (.md/.mdx) files found at that repo path.');
  }

  const branchRow = git.importBranchId ? await assertBranchInProject(projectId, git.importBranchId) : await ensureDefaultBranch(projectId);
  const language = git.importLanguageId ? await assertLanguageInProject(projectId, git.importLanguageId) : await ensureDefaultLanguage(projectId);

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
      const slug = slugify(part);
      const existing = await prisma.page.findFirst({
        where: { projectId, branchId: branchRow.id, languageId: language.id, parentId, slug, kind: 'GROUP' },
        select: { id: true },
      });
      const groupId = existing
        ? existing.id
        : (await createPage(projectId, { title: humanize(part), kind: 'GROUP', parentId, languageId: language.id, branchId: branchRow.id })).id;
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

    const found = await prisma.page.findFirst({
      where: { projectId, branchId: branchRow.id, languageId: language.id, parentId, slug },
      select: { id: true },
    });
    if (found) {
      await prisma.page.update({
        where: { id: found.id },
        data: {
          title,
          content: body,
          ...(meta.description ? { description: meta.description.slice(0, 500) } : {}),
          ...(meta.icon ? { icon: meta.icon.slice(0, 64) } : {}),
        },
      });
      summary.updated++;
    } else {
      await createPage(projectId, {
        title,
        slug,
        content: body,
        parentId,
        languageId: language.id,
        branchId: branchRow.id,
        ...(meta.description ? { description: meta.description.slice(0, 500) } : {}),
        ...(meta.icon ? { icon: meta.icon.slice(0, 64) } : {}),
      });
      summary.imported++;
    }
  }

  // Record that this repo is connected + when it last imported.
  metadata.git = { ...git, connected: true, lastImportedAt: new Date().toISOString() };
  await prisma.organization.update({ where: { id: organizationId }, data: { metadata: JSON.stringify(metadata) } });

  return summary;
};

export const importFromGitHub = importFromGitProvider;
