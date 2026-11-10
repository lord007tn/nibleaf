import type { Prisma } from '@nibleaf/database';
import {
  normalizeRedirectPath,
  type RedirectPair,
  snapshotRedirectOptions,
  summarizeRedirectIssues,
  validateRedirectGraph,
  validateSnapshotRedirects,
} from '@nibleaf/shared/redirects';
import { buildSnapshot, type SiteSnapshot } from '@nibleaf/shared/site';
import { badRequest, notFound } from '@/errors';
import { rewritePageLinks } from './rewrite-page-links';

export interface PagePathChange {
  id: string;
  branchId: string;
  languageId: string;
  oldLanguageId?: string;
  old: string;
  path: string;
}

/** Called with the project and page locks held, after recomputing draft paths. */
export const preservePageAddresses = async (projectId: string, changes: PagePathChange[], tx: Prisma.TransactionClient) => {
  const counts = { redirectsAdded: 0, linksUpdated: 0 };
  if (changes.length === 0) return counts;
  const project = await tx.project.findUnique({
    where: { id: projectId },
    include: {
      languages: { orderBy: { position: 'asc' } },
      branches: { orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] },
    },
  });
  if (!project) throw notFound('project', { id: projectId });
  const pages = await tx.page.findMany({ where: { projectId }, include: { language: { select: { code: true } } } });
  const snapshot = buildSnapshot(
    project,
    pages.map(({ language, createdAt, updatedAt, ...page }) => ({
      ...page,
      languageCode: language.code,
      createdAt: createdAt.toISOString(),
      updatedAt: updatedAt.toISOString(),
    })),
    new Date().toISOString(),
  );
  const latest = await tx.deployment.findFirst({ where: { projectId, status: 'READY' }, orderBy: { version: 'desc' } });
  const live = latest?.snapshot as unknown as SiteSnapshot | null;
  const versions = new Map(snapshot.project.versions.map((version) => [version.id, version]));
  const languages = new Map(project.languages.map((language) => [language.id, language]));
  const mappings = changes.flatMap((change) => {
    const version = versions.get(change.branchId);
    const language = languages.get(change.oldLanguageId ?? change.languageId);
    const targetLanguage = languages.get(change.languageId);
    if (!version || !language || !targetLanguage) return [];
    const prefix = version.isDefault ? '' : `${version.slug}/`;
    return [
      {
        ...change,
        from: normalizeRedirectPath(`${prefix}${change.old}`),
        to: normalizeRedirectPath(`${prefix}${change.path}`),
        language,
        targetLanguage,
      },
    ];
  });
  const options = snapshotRedirectOptions(snapshot);
  const occupied = new Set([...(options.routes ?? []).map((route) => route.path), ...(options.reservedPaths ?? [])]);
  const defaultCode = options.defaultLanguage;
  const rewriteHref = (href: string, languageCode: string, branchId?: string): string => {
    if (!href.startsWith('/') || href.startsWith('//')) return href;
    const split = /^([^?#]*)(\?[^#]*)?(#.*)?$/.exec(href);
    if (!split) return href;
    let query = split[2] ?? '';
    const explicitLanguage = new URLSearchParams(query).get('lang');
    let path: string;
    try {
      path = normalizeRedirectPath(split[1] ?? '');
    } catch {
      return href;
    }
    let mapping = mappings.find(
      (entry) => entry.from === path && entry.language.code === (explicitLanguage ?? languageCode) && (!branchId || entry.branchId === branchId),
    );
    let destination = mapping?.to;
    // The reader adds the current version to root-relative Markdown links.
    if (!mapping && branchId) {
      mapping = mappings.find(
        (entry) => entry.old === path && entry.branchId === branchId && entry.language.code === (explicitLanguage ?? languageCode),
      );
      destination = mapping?.path;
    }
    // Retain explicitly authored locale prefixes, without mistaking a real page
    // named after a language for a language prefix.
    if (!mapping && branchId && !occupied.has(path)) {
      mapping = mappings.find((entry) => entry.branchId === branchId && `${entry.language.code}/${entry.from}` === path);
      destination = mapping ? `${mapping.targetLanguage.code}/${mapping.to}` : undefined;
      if (!mapping) {
        mapping = mappings.find((entry) => entry.branchId === branchId && `${entry.language.code}/${entry.old}` === path);
        destination = mapping ? `${mapping.targetLanguage.code}/${mapping.path}` : undefined;
      }
    }
    if (!mapping) return href;
    if (mapping.language.code !== mapping.targetLanguage.code) {
      const params = new URLSearchParams(query);
      if (mapping.targetLanguage.isDefault) params.delete('lang');
      else params.set('lang', mapping.targetLanguage.code);
      query = params.size ? `?${params}` : '';
    }
    return `/${destination}${query}${split[3] ?? ''}`;
  };

  const raw = snapshot.project.config?.redirects;
  // Use the shared validator to reject malformed existing rows without losing them.
  const existingValidation = validateSnapshotRedirects({
    ...snapshot,
    project: { ...snapshot.project, config: { redirects: raw === undefined ? [] : raw } },
  });
  const malformed = existingValidation.issues.filter((issue) => issue.code.startsWith('malformed'));
  if (malformed.length) throw badRequest(summarizeRedirectIssues(malformed));
  const existing = (raw ?? []) as RedirectPair[];
  const graph = validateRedirectGraph(existing);
  if (graph.issues.length) throw badRequest(summarizeRedirectIssues(graph.issues));
  const destinations = new Set(mappings.map((mapping) => mapping.to));
  const redirects = graph.redirects
    .filter((redirect) => !destinations.has(normalizeRedirectPath(redirect.from)))
    .map((redirect) => ({ ...redirect, to: rewriteHref(redirect.to, defaultCode ?? '') }));
  for (const mapping of mappings) {
    const wasLive = live?.pages.some(
      (page) =>
        page.versionId === mapping.branchId &&
        page.languageCode === mapping.language.code &&
        page.path === mapping.old &&
        !page.hidden &&
        live.project.languages.some((language) => language.code === page.languageCode && (language.isDefault || language.enabled !== false)),
    );
    if (
      !wasLive ||
      occupied.has(mapping.from) ||
      !options.routes?.some((route) => route.path === mapping.to && route.languageCode === mapping.targetLanguage.code)
    )
      continue;
    const to = `/${mapping.to}${mapping.targetLanguage.isDefault ? '' : `?lang=${encodeURIComponent(mapping.targetLanguage.code)}`}`;
    const previous = redirects.findIndex((redirect) => normalizeRedirectPath(redirect.from) === mapping.from);
    if (previous >= 0) redirects.splice(previous, 1);
    else counts.redirectsAdded++;
    redirects.push({ from: `/${mapping.from}`, to });
  }
  if (JSON.stringify(redirects) !== JSON.stringify(existing)) {
    const validation = validateSnapshotRedirects({
      ...snapshot,
      project: { ...snapshot.project, config: { ...snapshot.project.config, redirects } },
    });
    if (validation.issues.length) throw badRequest(summarizeRedirectIssues(validation.issues));
    await tx.project.update({
      where: { id: projectId },
      data: { config: { ...(project.config as Prisma.JsonObject), redirects: validation.redirects.map(({ from, to }) => ({ from, to })) } },
    });
  }
  for (const page of pages) {
    if (!changes.some((change) => change.branchId === page.branchId)) continue;
    const previousLanguageId = changes.find((change) => change.id === page.id)?.oldLanguageId;
    const sourceLanguage = (previousLanguageId ? languages.get(previousLanguageId)?.code : undefined) ?? page.language.code;
    const result = rewritePageLinks(page.content, (href) => rewriteHref(href, sourceLanguage, page.branchId));
    if (!result.linksUpdated) continue;
    await tx.page.update({ where: { id: page.id }, data: { content: result.content } });
    counts.linksUpdated += result.linksUpdated;
  }
  return counts;
};
