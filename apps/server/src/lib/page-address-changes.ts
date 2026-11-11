import { type Prisma, prisma } from '@nibleaf/database';
import {
  normalizeRedirectPath,
  type RedirectPair,
  snapshotRedirectOptions,
  summarizeRedirectIssues,
  validateRedirectGraph,
  validateSnapshotRedirects,
} from '@nibleaf/shared/redirects';
import { buildSnapshot, type SiteSnapshot } from '@nibleaf/shared/site';
import { AppError, notFound } from '@/errors';
import { preparePageLinks } from './rewrite-page-links';

/** Parsing happens before entering the structural transaction. */
export const prepareAddressLinks = async (projectId: string, override?: { id: string; content?: string }) => {
  const pages = await prisma.page.findMany({ where: { projectId }, select: { id: true, content: true, updatedAt: true } });
  return new Map(
    pages.map((page) => [
      page.id,
      {
        content: page.content,
        updatedAt: page.updatedAt,
        links: preparePageLinks(override?.id === page.id && override.content !== undefined ? override.content : page.content),
      },
    ]),
  );
};
type PreparedAddressLinks = Awaited<ReturnType<typeof prepareAddressLinks>>;

export const assertAddressLinkRevisions = async (projectId: string, prepared: PreparedAddressLinks, tx: Prisma.TransactionClient) => {
  const pages = await tx.page.findMany({ where: { projectId }, select: { id: true, content: true, updatedAt: true } });
  if (
    pages.length !== prepared.size ||
    pages.some((page) => {
      const base = prepared.get(page.id);
      return !base || base.updatedAt.getTime() !== page.updatedAt.getTime() || base.content !== page.content;
    })
  )
    throw new AppError({
      code: 'page:address_conflict',
      message: 'Pages changed while links were prepared. Try the address change again.',
      details: { reason: 'address_raced' },
    });
};

const redirectFailure = (issues: import('@nibleaf/shared/redirects').RedirectValidationIssue[]) =>
  new AppError({ code: 'page:redirect_invalid', message: summarizeRedirectIssues(issues), details: { issues } });

export interface PagePathChange {
  id: string;
  branchId: string;
  languageId: string;
  oldLanguageId?: string;
  old: string;
  path: string;
}

/** Called with the project and page locks held, after recomputing draft paths. */
export const preservePageAddresses = async (
  projectId: string,
  changes: PagePathChange[],
  tx: Prisma.TransactionClient,
  prepared: PreparedAddressLinks,
) => {
  const counts = { redirectsAdded: 0, linksUpdated: 0, documentsSkipped: 0 };
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
  if (malformed.length) throw redirectFailure(malformed);
  const existing = (raw ?? []) as RedirectPair[];
  const graph = validateRedirectGraph(existing);
  if (graph.issues.length) throw redirectFailure(graph.issues);
  const destinations = new Set(mappings.map((mapping) => mapping.to));
  const refuseUserRule = (rule: RedirectPair) => {
    throw new AppError({
      code: 'page:address_conflict',
      message: `The user redirect ${rule.from} → ${rule.to} conflicts with this address change. Edit or remove it in Settings → Appearance → Redirects.`,
      details: { reason: 'user_redirect_conflict', from: rule.from, to: rule.to },
    });
  };
  for (const rule of graph.redirects) if (destinations.has(normalizeRedirectPath(rule.from)) && rule.generated !== true) refuseUserRule(rule);
  const redirects = graph.redirects
    .filter((redirect) => !destinations.has(normalizeRedirectPath(redirect.from)))
    .map((redirect) => ({ ...redirect, to: rewriteHref(redirect.to, defaultCode ?? '') }));
  const candidates: RedirectPair[] = [];
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
    const liveLanguages = new Set(
      live?.pages
        .filter(
          (page) =>
            page.versionId === mapping.branchId &&
            page.path === mapping.old &&
            !page.hidden &&
            live.project.languages.some((language) => language.code === page.languageCode && (language.isDefault || language.enabled !== false)),
        )
        .map((page) => page.languageCode),
    );
    if (liveLanguages.size > 1)
      throw new AppError({
        code: 'page:address_conflict',
        message: `Published languages share /${mapping.from}. A global redirect cannot safely select their destinations. Give these pages distinct addresses.`,
        details: { reason: 'locale_redirect_conflict', from: `/${mapping.from}`, languages: [...liveLanguages] },
      });
    const to = `/${mapping.to}${mapping.targetLanguage.isDefault ? '' : `?lang=${encodeURIComponent(mapping.targetLanguage.code)}`}`;
    const conflicting = candidates.find((rule) => rule.from === `/${mapping.from}` && rule.to !== to);
    if (conflicting)
      throw new AppError({
        code: 'page:address_conflict',
        message: `Languages need different redirects from /${mapping.from}. Use distinct source addresses or move one language at a time.`,
        details: { reason: 'locale_redirect_conflict', from: `/${mapping.from}`, destinations: [conflicting.to, to] },
      });
    candidates.push({ from: `/${mapping.from}`, to, generated: true });
  }
  for (const candidate of candidates) {
    const mappingFrom = normalizeRedirectPath(candidate.from);
    const previous = redirects.findIndex((redirect) => normalizeRedirectPath(redirect.from) === mappingFrom);
    if (previous >= 0) {
      const rule = redirects[previous];
      if (rule && rule.generated !== true) refuseUserRule(rule);
      redirects.splice(previous, 1);
    } else counts.redirectsAdded++;
    redirects.push(candidate);
  }
  if (JSON.stringify(redirects) !== JSON.stringify(existing)) {
    const validation = validateSnapshotRedirects({
      ...snapshot,
      project: { ...snapshot.project, config: { ...snapshot.project.config, redirects } },
    });
    if (validation.issues.length) throw redirectFailure(validation.issues);
    await tx.project.update({
      where: { id: projectId },
      data: { config: { ...(project.config as Prisma.JsonObject), redirects: validation.redirects.map((rule) => ({ ...rule })) } },
    });
  }
  for (const page of pages) {
    if (!changes.some((change) => change.branchId === page.branchId)) continue;
    const previousLanguageId = changes.find((change) => change.id === page.id)?.oldLanguageId;
    const sourceLanguage = (previousLanguageId ? languages.get(previousLanguageId)?.code : undefined) ?? page.language.code;
    const oldPath = changes.find((change) => change.id === page.id)?.old ?? page.path;
    const document = prepared.get(page.id);
    if (!document) throw new AppError({ code: 'page:address_conflict', details: { reason: 'address_raced' } });
    const result = document.links.rewrite((href) => {
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\?)/i.test(href)) return href;
      if (href.startsWith('/')) return rewriteHref(href, sourceLanguage, page.branchId);
      const absolute = new URL(href, `https://nibleaf.invalid/${oldPath}`);
      const resolved = `${absolute.pathname}${absolute.search}${absolute.hash}`;
      const rewritten = rewriteHref(resolved, sourceLanguage, page.branchId);
      return rewritten !== resolved || oldPath !== page.path ? rewritten : href;
    });
    counts.documentsSkipped += result.documentsSkipped;
    if (!result.linksUpdated) continue;
    await tx.page.update({
      where: { id: page.id },
      data: { content: result.content, updatedAt: new Date(Math.max(Date.now(), page.updatedAt.getTime() + 1)) },
    });
    counts.linksUpdated += result.linksUpdated;
  }
  return counts;
};
