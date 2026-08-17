import type { PublishDeploymentJobData } from '@nibleaf/bullmq/jobs/publish';
import { Prisma, prisma } from '@nibleaf/database';
import { createLogger } from '@nibleaf/logger';
import { summarizeRedirectIssues, validateSnapshotRedirects } from '@nibleaf/shared/redirects';
import { buildSnapshot } from '@nibleaf/shared/site';
import type { Job } from 'bullmq';
import { notifyDeployment } from '../lib/notify';

const log = createLogger({ processor: 'publish' });

const siteUrlFor = (projectId: string): string | undefined =>
  process.env.APP_URL ? `${process.env.APP_URL.replace(/\/$/, '')}/sites/${projectId}` : undefined;

/** Fire-and-forget platform funnel event (mirrors apps/server platform-events —
 *  the worker can't import server actions). Never throws into the publish flow. */
const logPlatformEvent = (type: string, data: { userId?: string | null; projectId?: string; metadata?: Record<string, unknown> }) =>
  prisma.platformEvent
    .create({
      data: {
        type,
        userId: data.userId ?? null,
        projectId: data.projectId ?? null,
        ...(data.metadata ? { metadata: data.metadata as Prisma.InputJsonValue } : {}),
      },
    })
    .catch(() => undefined);

type ProjectWithConfig = { config: unknown };
type PublishPage = {
  id: string;
  title: string;
  kind: string;
  path: string;
  content: string;
  hidden?: boolean | null;
  languageCode: string;
  branchId: string;
};

/** One structured check failure, persisted as `Deployment.errorDetails` JSON so
 *  the dashboard can render a per-page failure list. */
export interface PublishIssue {
  type: 'broken-link' | 'grammar';
  pageTitle: string;
  pagePath: string;
  detail: string;
}

/** A check failure that blocks the publish, carrying the structured issues. */
export class PublishChecksError extends Error {
  readonly issues: PublishIssue[];
  constructor(message: string, issues: PublishIssue[]) {
    super(message);
    this.name = 'PublishChecksError';
    this.issues = issues;
  }
}

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
 * Returns structured issues instead of throwing so the caller can persist them
 * as `Deployment.errorDetails`. Broken links ALWAYS block (when enabled);
 * `skipGrammarChecks` lets a user publish past the grammar linter only.
 */
export function collectPublishIssues(
  project: ProjectWithConfig,
  pages: PublishPage[],
  options: { skipGrammarChecks?: boolean } = {},
): PublishIssue[] {
  const addons = objectValue(objectValue(project.config).addons);
  if (addons.ciChecks === false) {
    return [];
  }
  const issues: PublishIssue[] = [];

  if (addons.brokenLinks !== false) {
    const pathsByScope = new Map<string, Set<string>>();
    for (const page of pages) {
      if (page.kind !== 'PAGE' || page.hidden) {
        continue;
      }
      const scope = `${page.languageCode}:${page.branchId}`;
      const set = pathsByScope.get(scope) ?? new Set<string>();
      set.add(normalizedPagePath(page.path));
      pathsByScope.set(scope, set);
    }

    for (const page of pages) {
      if (page.kind !== 'PAGE' || page.hidden) {
        continue;
      }
      const currentPath = normalizedPagePath(page.path);
      const scope = `${page.languageCode}:${page.branchId}`;
      const scopePaths = pathsByScope.get(scope) ?? new Set<string>();
      for (const href of markdownLinks(page.content)) {
        const target = internalLinkTarget(href, currentPath);
        if (!target || target === 'changelog') {
          continue;
        }
        if (!scopePaths.has(target)) {
          issues.push({
            type: 'broken-link',
            pageTitle: page.title,
            pagePath: currentPath || '/',
            detail: `Link to "${href}" does not match any page.`,
          });
        }
      }
    }
  }

  if (addons.grammarLinter === true && options.skipGrammarChecks !== true) {
    for (const page of pages) {
      if (page.kind !== 'PAGE' || page.hidden) {
        continue;
      }
      const currentPath = normalizedPagePath(page.path);
      for (const issue of grammarIssues(page.content)) {
        issues.push({ type: 'grammar', pageTitle: page.title, pagePath: currentPath || '/', detail: issue });
      }
    }
  }

  return issues;
}

/** Human summary for `Deployment.error` (the structured list goes to errorDetails). */
const summarizeIssues = (issues: PublishIssue[]): string => {
  const broken = issues.filter((issue) => issue.type === 'broken-link');
  const grammar = issues.filter((issue) => issue.type === 'grammar');
  const parts: string[] = [];
  if (broken.length > 0) {
    const sample = broken
      .slice(0, 8)
      .map((issue) => `${issue.pagePath} -> ${issue.detail}`)
      .join('; ');
    parts.push(`Broken internal links found (${broken.length}): ${sample}`);
  }
  if (grammar.length > 0) {
    const sample = grammar
      .slice(0, 8)
      .map((issue) => `${issue.pagePath}: ${issue.detail}`)
      .join('; ');
    parts.push(`Grammar lint issues found (${grammar.length}): ${sample}`);
  }
  return parts.join(' | ');
};

/** Persisted `errorDetails` is capped so a check failure on a large site can't
 *  ship a multi-MB JSONB blob to the dashboard (which renders one <li> per
 *  issue). The array shape the dashboard consumes ([{type,pageTitle,pagePath,
 *  detail}]) is preserved; when truncated, a final synthetic entry records the
 *  omitted count. Its `type` mirrors whether any broken link is present so the
 *  dashboard's grammar-only "Publish anyway" gate stays correct — broken links
 *  always block, so a truncated set that still contains one must not read as
 *  grammar-only. */
const MAX_PERSISTED_ISSUES = 100;

const capIssues = (issues: PublishIssue[]): PublishIssue[] => {
  if (issues.length <= MAX_PERSISTED_ISSUES) {
    return issues;
  }
  const omitted = issues.length - MAX_PERSISTED_ISSUES;
  const type: PublishIssue['type'] = issues.some((issue) => issue.type === 'broken-link') ? 'broken-link' : 'grammar';
  return [
    ...issues.slice(0, MAX_PERSISTED_ISSUES),
    { type, pageTitle: 'Additional issues', pagePath: '', detail: `…and ${omitted} more issue${omitted === 1 ? '' : 's'} not shown.` },
  ];
};

/**
 * Build an immutable snapshot of the project's docs and mark the deployment
 * READY. The live site and search index are served from this snapshot.
 */
export async function handlePublishJobs(job: Job<PublishDeploymentJobData>): Promise<{ pages: number }> {
  const { deploymentId, projectId, skipGrammarChecks, auto } = job.data;
  log.info({ deploymentId, projectId }, 'building deployment');

  await prisma.deployment.update({ where: { id: deploymentId }, data: { status: 'BUILDING' } });

  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        languages: { orderBy: { position: 'asc' }, include: { projectTranslations: { take: 1 } } },
        branches: { orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] },
        openApiDocument: true,
      },
    });
    if (!project) {
      throw new Error(`project ${projectId} not found`);
    }
    // Moderation backstop: a taken-down site must never build a new deployment,
    // even if a publish request slipped past the API-side check.
    if (project.takedownAt) {
      throw new Error('This site has been taken down by the platform moderators and cannot be published.');
    }
    // Publish every branch as an addressable docs version. This keeps v1 live
    // while v2 is being authored, and visitors can switch versions on the site.
    const branchIds = project.branches.map((branch) => branch.id);
    const pages = await prisma.page.findMany({
      where: { projectId, branchId: { in: branchIds } },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      include: { language: { select: { code: true } } },
    });
    const pageRows = pages.map(({ language, createdAt, updatedAt, ...page }) => ({
      ...page,
      languageCode: language.code,
      createdAt: createdAt.toISOString(),
      updatedAt: updatedAt.toISOString(),
    }));
    const issues = collectPublishIssues(project, pageRows, { skipGrammarChecks: skipGrammarChecks === true });
    if (issues.length > 0) {
      throw new PublishChecksError(summarizeIssues(issues), issues);
    }
    const redirectValidation = validateSnapshotRedirects(buildSnapshot(project, pageRows, new Date().toISOString()));
    if (redirectValidation.issues.length > 0) {
      throw new Error(summarizeRedirectIssues(redirectValidation.issues));
    }
    const snapshot = redirectValidation.snapshot;
    const pageCount = pages.filter((page) => page.kind === 'PAGE').length;

    const ready = await prisma.deployment.update({
      where: { id: deploymentId },
      data: { status: 'READY', snapshot: snapshot as unknown as object, pagesCount: pageCount, errorDetails: Prisma.DbNull, completedAt: new Date() },
    });
    log.info({ deploymentId, pageCount }, 'deployment ready');
    await logPlatformEvent('publish_ready', {
      userId: ready.createdById,
      projectId,
      metadata: { auto: auto === true, version: ready.version },
    });
    await notifyDeployment({ projectId, projectName: project.name, version: ready.version, outcome: 'ready', siteUrl: siteUrlFor(projectId) });
    return { pages: pages.length };
  } catch (error) {
    const failed = await prisma.deployment.update({
      where: { id: deploymentId },
      data: {
        status: 'FAILED',
        error: error instanceof Error ? error.message : String(error),
        // ALWAYS overwrite errorDetails: a retry that fails with a transient
        // infra error (after attempt 1 recorded check issues) must clear the
        // stale grammar/link list, or the dashboard offers "Publish anyway" for
        // a connection failure.
        errorDetails: error instanceof PublishChecksError ? (capIssues(error.issues) as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
      },
    });
    const proj = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true } });
    await logPlatformEvent('publish_failed', {
      userId: failed.createdById,
      projectId,
      metadata: { auto: auto === true, version: failed.version, checksFailed: error instanceof PublishChecksError },
    });
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
