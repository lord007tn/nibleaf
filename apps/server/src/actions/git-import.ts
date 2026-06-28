import { prisma } from '@plume/database';
import { slugify } from '@plume/shared';
import type { GitConfig } from '@plume/validators';
import { badRequest } from '@/errors';
import { ensureDefaultBranch } from './branches';
import { ensureDefaultLanguage } from './languages';
import { createPage } from './pages';
import { assertProjectInOrg } from './projects';

interface GitHubTreeItem {
  path: string;
  type: 'blob' | 'tree';
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

/**
 * One-way import: pull Markdown/MDX files from a PUBLIC GitHub repo (the configured
 * repo/branch/path on the project's org) into the default branch + default language,
 * recreating the folder structure as page groups. Idempotent — re-importing updates a
 * page in place (matched by parent + slug) instead of duplicating it. Uses one GitHub
 * tree API call + the raw.githubusercontent CDN for file bodies (no rate-limited content
 * calls, public repos only).
 */
export const importFromGitHub = async (organizationId: string, projectId: string): Promise<GitImportSummary> => {
  await assertProjectInOrg(organizationId, projectId);

  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { metadata: true } });
  const metadata = org?.metadata ? (JSON.parse(org.metadata) as Record<string, unknown>) : {};
  const git = (metadata.git ?? {}) as GitConfig;
  if (git.provider !== 'github' || !git.repo || !git.repo.includes('/')) {
    throw badRequest('Connect a GitHub repository (owner/repo) first.');
  }
  const [owner, repo] = git.repo.split('/');
  const branch = git.branch?.trim() || 'main';
  const basePath = (git.path ?? '').replace(/^\/+|\/+$/g, '');
  const prefix = basePath ? `${basePath}/` : '';

  // 1) One tree call lists every path in the branch.
  const treeRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'plume-docs' },
  });
  if (!treeRes.ok) {
    throw badRequest(
      treeRes.status === 404
        ? 'Repository or branch not found. Imports support public GitHub repositories only.'
        : `GitHub API error (${treeRes.status}). Try again shortly.`,
    );
  }
  const tree = (await treeRes.json()) as { tree?: GitHubTreeItem[] };
  const mdFiles = (tree.tree ?? [])
    .filter((i) => i.type === 'blob' && (i.path.endsWith('.md') || i.path.endsWith('.mdx')) && i.path.startsWith(prefix))
    .slice(0, MAX_FILES);
  if (mdFiles.length === 0) {
    throw badRequest('No Markdown (.md/.mdx) files found at that repo path.');
  }

  const branchRow = await ensureDefaultBranch(projectId);
  const language = await ensureDefaultLanguage(projectId);

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
    const rawRes = await fetch(
      `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${file.path.split('/').map(encodeURIComponent).join('/')}`,
      { headers: { 'User-Agent': 'plume-docs' } },
    );
    if (!rawRes.ok) {
      summary.skipped++;
      continue;
    }
    const text = await rawRes.text();
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
