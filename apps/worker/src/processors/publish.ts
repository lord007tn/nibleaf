import type { PublishDeploymentJobData } from '@midad/bullmq/jobs/publish';
import { prisma } from '@midad/database';
import { createLogger } from '@midad/logger';
import { buildSnapshot } from '@midad/shared/site';
import type { Job } from 'bullmq';
import { notifyDeployment } from '../lib/notify';

const log = createLogger({ processor: 'publish' });

const siteUrlFor = (projectId: string): string | undefined =>
  process.env.APP_URL ? `${process.env.APP_URL.replace(/\/$/, '')}/sites/${projectId}` : undefined;

type ProjectWithConfig = { config: unknown };
type PublishPage = {
  kind: string;
  path: string;
  content: string;
  hidden?: boolean | null;
  languageCode?: string | null;
  branchId?: string | null;
  branch?: { id: string } | null;
};

const objectValue = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const normalizedPagePath = (path: string): string => path.replace(/^\/+|\/+$/g, '').replace(/\.(mdx?|html)$/i, '');

const hasAssetExtension = (path: string): boolean => /\.[a-z0-9]{2,8}$/i.test(path) && !/\.(mdx?|html)$/i.test(path);

const internalLinkTarget = (href: string, currentPath: string): string | null => {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith('//') || trimmed.startsWith('{')) {
    return null;
  }

  const withoutHash = trimmed.split('#')[0]?.split('?')[0]?.trim() ?? '';
  if (!withoutHash || withoutHash === '/') {
    return null;
  }
  if (hasAssetExtension(withoutHash)) {
    return null;
  }

  const base = currentPath.includes('/') ? currentPath.split('/').slice(0, -1) : [];
  const parts = withoutHash.startsWith('/') ? [] : [...base];
  for (const segment of withoutHash.replace(/^\/+/, '').split('/')) {
    if (!segment || segment === '.') {
      continue;
    }
    if (segment === '..') {
      parts.pop();
      continue;
    }
    parts.push(segment);
  }

  return normalizedPagePath(parts.join('/'));
};

const markdownLinks = (content: string): string[] => {
  const links: string[] = [];
  for (const match of content.matchAll(/(?<!!)\[[^\]]*]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g)) {
    if (match[1]) {
      links.push(match[1]);
    }
  }
  for (const match of content.matchAll(/\bhref=["']([^"']+)["']/g)) {
    if (match[1]) {
      links.push(match[1]);
    }
  }
  return links;
};

const stripCodeForCopyChecks = (content: string): string =>
  content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/<pre[\s\S]*?<\/pre>/gi, ' ')
    .replace(/<code[\s\S]*?<\/code>/gi, ' ');

const GRAMMAR_PATTERNS: Array<{ pattern: RegExp; message: string }> = [
  { pattern: /\bteh\b/i, message: 'Use "the" instead of "teh".' },
  { pattern: /\brecieve\b/i, message: 'Use "receive" instead of "recieve".' },
  { pattern: /\bseperate\b/i, message: 'Use "separate" instead of "seperate".' },
  { pattern: /\boccured\b/i, message: 'Use "occurred" instead of "occured".' },
  { pattern: /\bdefinately\b/i, message: 'Use "definitely" instead of "definately".' },
  { pattern: /\bpublically\b/i, message: 'Use "publicly" instead of "publically".' },
  { pattern: /\bcan not\b/i, message: 'Prefer "cannot" in documentation copy.' },
  { pattern: /\bthis are\b/i, message: 'Use "this is" or "these are".' },
];

const grammarIssues = (content: string): string[] => {
  const copy = stripCodeForCopyChecks(content);
  const issues: string[] = [];
  for (const rule of GRAMMAR_PATTERNS) {
    if (rule.pattern.test(copy)) {
      issues.push(rule.message);
    }
  }
  return issues;
};

/**
 * Publish-time add-on checks. The self-hosted free target treats CI checks as
 * the umbrella toggle and runs concrete local gates without hosted integrations.
 */
export function validatePublishChecks(project: ProjectWithConfig, pages: PublishPage[]): void {
  const addons = objectValue(objectValue(project.config).addons);
  if (addons.ciChecks === false) {
    return;
  }

  if (addons.brokenLinks !== false) {
    const pathsByScope = new Map<string, Set<string>>();
    for (const page of pages) {
      if (page.kind !== 'PAGE' || page.hidden) {
        continue;
      }
      const scope = `${page.languageCode ?? ''}:${page.branchId ?? page.branch?.id ?? ''}`;
      const set = pathsByScope.get(scope) ?? new Set<string>();
      set.add(normalizedPagePath(page.path));
      pathsByScope.set(scope, set);
    }

    const broken: string[] = [];
    for (const page of pages) {
      if (page.kind !== 'PAGE' || page.hidden) {
        continue;
      }
      const currentPath = normalizedPagePath(page.path);
      const scope = `${page.languageCode ?? ''}:${page.branchId ?? page.branch?.id ?? ''}`;
      const scopePaths = pathsByScope.get(scope) ?? new Set<string>();
      for (const href of markdownLinks(page.content)) {
        const target = internalLinkTarget(href, currentPath);
        if (!target || target === 'changelog') {
          continue;
        }
        if (!scopePaths.has(target)) {
          broken.push(`${currentPath || '/'} -> ${href}`);
        }
      }
    }

    if (broken.length > 0) {
      const sample = broken.slice(0, 8).join('; ');
      throw new Error(`Broken internal links found (${broken.length}): ${sample}`);
    }
  }

  if (addons.grammarLinter === true) {
    const grammar: string[] = [];
    for (const page of pages) {
      if (page.kind !== 'PAGE' || page.hidden) {
        continue;
      }
      const currentPath = normalizedPagePath(page.path);
      for (const issue of grammarIssues(page.content)) {
        grammar.push(`${currentPath || '/'}: ${issue}`);
      }
    }

    if (grammar.length > 0) {
      const sample = grammar.slice(0, 8).join('; ');
      throw new Error(`Grammar lint issues found (${grammar.length}): ${sample}`);
    }
  }
}

/**
 * Build an immutable snapshot of the project's docs and mark the deployment
 * READY. The live site and search index are served from this snapshot.
 */
export async function handlePublishJobs(job: Job<PublishDeploymentJobData>): Promise<{ pages: number }> {
  const { deploymentId, projectId } = job.data;
  log.info({ deploymentId, projectId }, 'building deployment');

  await prisma.deployment.update({ where: { id: deploymentId }, data: { status: 'BUILDING' } });

  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { languages: { orderBy: { position: 'asc' } }, branches: { orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] } },
    });
    if (!project) {
      throw new Error(`project ${projectId} not found`);
    }
    // Publish every branch as an addressable docs version. This keeps v1 live
    // while v2 is being authored, and visitors can switch versions on the site.
    const branchIds = project.branches.map((branch) => branch.id);
    const pages = await prisma.page.findMany({
      where: { projectId, ...(branchIds.length > 0 ? { branchId: { in: branchIds } } : {}) },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      include: { language: { select: { code: true } }, branch: { select: { id: true, name: true, isDefault: true } } },
    });
    const pageRows = pages.map(({ language, ...page }) => ({ ...page, languageCode: language?.code }));
    validatePublishChecks(project, pageRows);
    const snapshot = buildSnapshot(project, pageRows, new Date().toISOString());
    const pageCount = pages.filter((page) => page.kind === 'PAGE').length;

    const ready = await prisma.deployment.update({
      where: { id: deploymentId },
      data: { status: 'READY', snapshot: snapshot as unknown as object, pagesCount: pageCount, completedAt: new Date() },
    });
    log.info({ deploymentId, pageCount }, 'deployment ready');
    await notifyDeployment({ projectId, projectName: project.name, version: ready.version, outcome: 'ready', siteUrl: siteUrlFor(projectId) });
    return { pages: pages.length };
  } catch (error) {
    const failed = await prisma.deployment.update({
      where: { id: deploymentId },
      data: { status: 'FAILED', error: error instanceof Error ? error.message : String(error) },
    });
    const proj = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true } });
    await notifyDeployment({
      projectId,
      projectName: proj?.name ?? 'Your site',
      version: failed.version,
      outcome: 'failed',
      error: failed.error ?? undefined,
    });
    throw error;
  }
}
