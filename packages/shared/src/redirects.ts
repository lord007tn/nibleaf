import { buildNavTree, type NavNode, publicLanguages, type SiteSnapshot } from './site';

/** Redirects are deliberately bounded: a long chain is almost always an
 * authoring mistake and makes graph diagnostics needlessly expensive. */
export const MAX_REDIRECT_CHAIN_LENGTH = 10;
export const MAX_REDIRECT_RULES = 100;

export interface RedirectPair {
  from: string;
  to: string;
}

export type RedirectIssueCode =
  | 'malformed-source'
  | 'malformed-destination'
  | 'duplicate-source'
  | 'self-redirect'
  | 'cycle'
  | 'chain-too-long'
  | 'too-many-rules'
  | 'source-collision'
  | 'destination-not-found'
  | 'invalid-locale'
  | 'route-collision';

/** A stable, serializable issue shape shared by the editor, API and worker. */
export interface RedirectValidationIssue {
  code: RedirectIssueCode;
  message: string;
  /** Normalized path sequence involved in the error, in traversal order. */
  sequence: string[];
  /** Zero-based config rows involved in the error. */
  rowIndexes: number[];
  field?: 'from' | 'to';
}

export interface RedirectRoute {
  /** Site-relative route, without leading/trailing slash. */
  path: string;
  /** Final renderable page route (group/root aliases point at their first page). */
  canonicalPath: string;
  languageCode: string;
}

export interface RedirectGraphOptions {
  routes?: readonly RedirectRoute[];
  defaultLanguage?: string;
  enabledLanguages?: readonly string[];
  reservedPaths?: readonly string[];
  routeCollisions?: readonly string[];
  maxChainLength?: number;
}

export interface RedirectGraphResult {
  /** Normalized, single-hop redirects. Empty whenever validation fails. */
  redirects: RedirectPair[];
  issues: RedirectValidationIssue[];
}

type ParsedInternal = { kind: 'internal'; path: string; query: string; fragment: string; href: string; language: string | null };
type ParsedExternal = { kind: 'external'; href: string };
type ParsedDestination = ParsedInternal | ParsedExternal;
type ParsedRule = { index: number; from: string; target: ParsedDestination };

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const ENCODED_SEPARATOR = /%(?:2f|5c)/i;

const hasControlCharacters = (value: string): boolean => {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 31 || code === 127) {
      return true;
    }
  }
  return false;
};

const displayPath = (path: string): string => (path ? `/${path}` : '/');

/** Normalize a site-relative path exactly as the published router does: leading,
 * duplicate and trailing slashes are insignificant. Encoded Unicode is decoded
 * so it cannot bypass duplicate/collision checks; encoded separators and dot
 * segments are rejected because proxies disagree about their meaning. */
export const normalizeRedirectPath = (input: string): string => {
  const value = input.trim();
  if (hasControlCharacters(value) || value.includes('\\') || ENCODED_SEPARATOR.test(value)) {
    throw new Error('Paths cannot contain control characters, backslashes, or encoded path separators.');
  }
  const normalized: string[] = [];
  for (const rawSegment of value.split('/')) {
    if (!rawSegment) {
      continue;
    }
    let segment: string;
    try {
      segment = decodeURIComponent(rawSegment).normalize('NFC');
    } catch {
      throw new Error('Path contains invalid percent encoding.');
    }
    if (!segment || segment === '.' || segment === '..' || segment.includes('/') || segment.includes('\\') || hasControlCharacters(segment)) {
      throw new Error('Paths cannot contain dot segments or encoded separators.');
    }
    normalized.push(segment);
  }
  return normalized.join('/');
};

const splitInternalTarget = (input: string): { pathname: string; query: string; fragment: string } => {
  const hashAt = input.indexOf('#');
  const beforeHash = hashAt >= 0 ? input.slice(0, hashAt) : input;
  const fragment = hashAt >= 0 ? input.slice(hashAt + 1) : '';
  const queryAt = beforeHash.indexOf('?');
  return {
    pathname: queryAt >= 0 ? beforeHash.slice(0, queryAt) : beforeHash,
    query: queryAt >= 0 ? beforeHash.slice(queryAt + 1) : '',
    fragment,
  };
};

const assertValidEncodedComponent = (value: string, label: string): void => {
  if (hasControlCharacters(value)) {
    throw new Error(`${label} cannot contain control characters.`);
  }
  // decodeURIComponent is stricter than URLSearchParams and catches a dangling
  // '%' while still allowing the delimiters that belong to a query string.
  try {
    decodeURIComponent(value.replace(/%(?![0-9a-f]{2})/gi, '%25'));
  } catch {
    throw new Error(`${label} contains invalid percent encoding.`);
  }
  if (/%(?![0-9a-f]{2})/i.test(value)) {
    throw new Error(`${label} contains invalid percent encoding.`);
  }
};

const parseDestination = (raw: string): ParsedDestination => {
  const value = raw.trim();
  if (!value) {
    throw new Error('A redirect destination is required.');
  }
  if (hasControlCharacters(value)) {
    throw new Error('Redirect destinations cannot contain control characters.');
  }
  if (SCHEME.test(value)) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error('External destinations must be valid absolute URLs.');
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error('Only HTTP and HTTPS external destinations are permitted.');
    }
    if (!url.hostname || url.username || url.password) {
      throw new Error('External destinations must have a hostname and cannot contain credentials.');
    }
    return { kind: 'external', href: url.href };
  }
  if (value.startsWith('//')) {
    throw new Error('Protocol-relative external destinations are not permitted; use an HTTPS URL.');
  }

  const { pathname, query, fragment } = splitInternalTarget(value);
  if (SCHEME.test(pathname)) {
    throw new Error('Internal destinations must be site-relative paths.');
  }
  assertValidEncodedComponent(query, 'Redirect query');
  assertValidEncodedComponent(fragment, 'Redirect fragment');
  const path = normalizeRedirectPath(pathname);
  const params = new URLSearchParams(query);
  const languages = params.getAll('lang');
  if (languages.length > 1) {
    throw new Error('Internal destinations can specify the lang query parameter only once.');
  }
  const language = languages[0]?.trim() ?? null;
  if (languages.length === 1 && !language) {
    throw new Error('The lang query parameter cannot be empty.');
  }
  const href = `${displayPath(path)}${query ? `?${query}` : ''}${fragment ? `#${fragment}` : ''}`;
  return { kind: 'internal', path, query, fragment, href, language };
};

const parseSource = (raw: string): string => {
  const value = raw.trim();
  if (!value) {
    throw new Error('A redirect source is required.');
  }
  if (value.includes('?') || value.includes('#') || value.startsWith('//') || SCHEME.test(value)) {
    throw new Error('Redirect sources must be site-relative paths without a query or fragment.');
  }
  return normalizeRedirectPath(value);
};

const uniqueNumbers = (values: number[]): number[] => [...new Set(values)].sort((a, b) => a - b);

const issue = (
  code: RedirectIssueCode,
  message: string,
  sequence: string[],
  rowIndexes: number[],
  field?: 'from' | 'to',
): RedirectValidationIssue => ({ code, message, sequence, rowIndexes: uniqueNumbers(rowIndexes), ...(field ? { field } : {}) });

const sequenceText = (sequence: string[]): string => sequence.join(' -> ');

/** Validate and flatten the effective redirect graph. With a route manifest,
 * every internal destination must resolve to a published page and every source
 * is checked against live/reserved routes. Without one this still provides the
 * editor/schema's immediate syntax, duplicate, cycle and chain validation. */
export function validateRedirectGraph(redirects: readonly RedirectPair[], options: RedirectGraphOptions = {}): RedirectGraphResult {
  const issues: RedirectValidationIssue[] = [];
  const parsed: ParsedRule[] = [];
  const bySource = new Map<string, ParsedRule>();

  if (redirects.length > MAX_REDIRECT_RULES) {
    issues.push(issue('too-many-rules', `Redirect configuration has ${redirects.length} rules; the limit is ${MAX_REDIRECT_RULES}.`, [], []));
  }

  for (const [index, redirect] of redirects.entries()) {
    const rawFrom = typeof redirect?.from === 'string' ? redirect.from : '';
    const rawTo = typeof redirect?.to === 'string' ? redirect.to : '';
    if (!rawFrom.trim() && !rawTo.trim()) {
      continue;
    }
    if (!rawFrom.trim() || !rawTo.trim()) {
      const field = rawFrom.trim() ? 'to' : 'from';
      issues.push(
        issue(
          field === 'from' ? 'malformed-source' : 'malformed-destination',
          'A redirect must have both a source and a destination.',
          [],
          [index],
          field,
        ),
      );
      continue;
    }

    let from: string;
    let target: ParsedDestination;
    try {
      from = parseSource(rawFrom);
    } catch (error) {
      issues.push(
        issue('malformed-source', error instanceof Error ? error.message : 'Malformed redirect source.', [rawFrom.trim()], [index], 'from'),
      );
      continue;
    }
    try {
      target = parseDestination(rawTo);
    } catch (error) {
      issues.push(
        issue(
          'malformed-destination',
          error instanceof Error ? error.message : 'Malformed redirect destination.',
          [displayPath(from), rawTo.trim()],
          [index],
          'to',
        ),
      );
      continue;
    }

    const current: ParsedRule = { index, from, target };
    const duplicate = bySource.get(from);
    if (duplicate) {
      const qualifier = duplicate.target.href === target.href ? 'Duplicate' : 'Conflicting';
      issues.push(
        issue(
          'duplicate-source',
          `${qualifier} redirect source ${displayPath(from)} (rows ${duplicate.index + 1} and ${index + 1}).`,
          [displayPath(from), duplicate.target.href, target.href],
          [duplicate.index, index],
          'from',
        ),
      );
      continue;
    }
    bySource.set(from, current);
    parsed.push(current);
  }

  const routeMap = new Map<string, string>();
  for (const route of options.routes ?? []) {
    try {
      routeMap.set(`${route.languageCode}:${normalizeRedirectPath(route.path)}`, normalizeRedirectPath(route.canonicalPath));
    } catch {
      // A route manifest is generated from trusted snapshot paths. Invalid page
      // paths are intentionally absent so they cannot validate a destination.
    }
  }
  const publishedPaths = new Set([...routeMap.keys()].map((key) => key.slice(key.indexOf(':') + 1)));
  const reserved = new Set((options.reservedPaths ?? []).map((path) => normalizeRedirectPath(path)));
  for (const collision of options.routeCollisions ?? []) {
    const path = displayPath(normalizeRedirectPath(collision));
    issues.push(
      issue('route-collision', `Published route collision at ${path}; page routes must be unique before redirects can be emitted.`, [path], []),
    );
  }

  for (const rule of parsed) {
    const targetPath = rule.target.kind === 'internal' ? rule.target.path : null;
    if (targetPath === rule.from) {
      const sequence = [displayPath(rule.from), rule.target.href];
      issues.push(issue('self-redirect', `Redirect points to itself: ${sequenceText(sequence)}.`, sequence, [rule.index], 'to'));
    }
    if (publishedPaths.has(rule.from) || reserved.has(rule.from)) {
      const path = displayPath(rule.from);
      issues.push(issue('source-collision', `Redirect source ${path} collides with a published or reserved route.`, [path], [rule.index], 'from'));
    }
  }

  const maxChainLength = options.maxChainLength ?? MAX_REDIRECT_CHAIN_LENGTH;
  const flattened: RedirectPair[] = [];
  const seenCycleKeys = new Set<string>();
  const seenLongChains = new Set<string>();

  for (const start of parsed) {
    let current = start;
    const sequence: string[] = [displayPath(start.from)];
    const rowIndexes: number[] = [];
    const visitedAt = new Map<string, number>();
    let carriedQuery = '';
    let carriedFragment = '';
    let finalTarget: ParsedDestination | null = null;

    while (true) {
      const cycleAt = visitedAt.get(current.from);
      if (cycleAt !== undefined) {
        const cycleSequence = sequence.slice(cycleAt);
        const key = [...new Set(cycleSequence)].sort().join('\u0000');
        const isAlreadyReportedSelfRedirect = cycleSequence.length === 2 && cycleSequence[0] === cycleSequence[1];
        if (!isAlreadyReportedSelfRedirect && !seenCycleKeys.has(key)) {
          seenCycleKeys.add(key);
          issues.push(issue('cycle', `Redirect cycle detected: ${sequenceText(cycleSequence)}.`, cycleSequence, rowIndexes, 'to'));
        }
        finalTarget = null;
        break;
      }
      visitedAt.set(current.from, sequence.length - 1);
      rowIndexes.push(current.index);
      if (rowIndexes.length > maxChainLength) {
        const key = sequence.join('\u0000');
        if (!seenLongChains.has(key)) {
          seenLongChains.add(key);
          issues.push(
            issue('chain-too-long', `Redirect chain exceeds the ${maxChainLength}-hop limit: ${sequenceText(sequence)}.`, sequence, rowIndexes, 'to'),
          );
        }
        finalTarget = null;
        break;
      }

      const target = current.target;
      sequence.push(target.kind === 'external' ? target.href : displayPath(target.path));
      if (target.kind === 'external') {
        finalTarget = target;
        break;
      }
      if (target.query) {
        carriedQuery = target.query;
      }
      if (target.fragment) {
        carriedFragment = target.fragment;
      }
      const next = bySource.get(target.path);
      if (!next) {
        finalTarget = {
          ...target,
          query: carriedQuery,
          fragment: carriedFragment,
          href: `${displayPath(target.path)}${carriedQuery ? `?${carriedQuery}` : ''}${carriedFragment ? `#${carriedFragment}` : ''}`,
          language: new URLSearchParams(carriedQuery).get('lang'),
        };
        break;
      }
      current = next;
    }

    if (!finalTarget) {
      continue;
    }
    if (finalTarget.kind === 'external') {
      flattened.push({ from: displayPath(start.from), to: finalTarget.href });
      continue;
    }

    let finalPath = finalTarget.path;
    if (options.routes) {
      const language = finalTarget.language ?? options.defaultLanguage;
      if (finalTarget.language && options.enabledLanguages && !options.enabledLanguages.includes(finalTarget.language)) {
        issues.push(
          issue(
            'invalid-locale',
            `Redirect destination uses unavailable locale "${finalTarget.language}": ${sequenceText(sequence)}.`,
            sequence,
            rowIndexes,
            'to',
          ),
        );
        continue;
      }
      const canonical = language ? routeMap.get(`${language}:${finalPath}`) : undefined;
      if (canonical === undefined) {
        issues.push(
          issue(
            'destination-not-found',
            `Redirect destination does not resolve to a published page: ${sequenceText(sequence)}.`,
            sequence,
            rowIndexes,
            'to',
          ),
        );
        continue;
      }
      finalPath = canonical;
    }
    flattened.push({
      from: displayPath(start.from),
      to: `${displayPath(finalPath)}${finalTarget.query ? `?${finalTarget.query}` : ''}${finalTarget.fragment ? `#${finalTarget.fragment}` : ''}`,
    });
  }

  return { redirects: issues.length > 0 ? [] : flattened, issues };
}

/** Runtime compatibility helper for snapshots published before redirects were
 * flattened. It follows the same normalization/query/fragment rules and refuses
 * malformed, cyclic or overlong stored graphs. */
export const resolveRedirectTarget = (redirects: readonly RedirectPair[], path: string): string | null => {
  let source: string;
  try {
    source = parseSource(path);
  } catch {
    return null;
  }
  const result = validateRedirectGraph(redirects);
  if (result.issues.length > 0) {
    return null;
  }
  return result.redirects.find((redirect) => normalizeRedirectPath(redirect.from) === source)?.to ?? null;
};

const flattenPages = (nodes: readonly NavNode[]): NavNode[] =>
  nodes.flatMap((node) => (node.kind === 'PAGE' ? [node, ...flattenPages(node.children)] : flattenPages(node.children)));

const prefixesOf = (path: string): string[] => {
  const parts = path.split('/').filter(Boolean);
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'));
};

export interface SnapshotRedirectValidation extends RedirectGraphResult {
  snapshot: SiteSnapshot;
}

/** Build the effective locale/version/base-path route manifest and validate the
 * redirects stored in a publish snapshot. Successful snapshots contain only
 * normalized direct redirects; failures return the original snapshot untouched. */
export function validateSnapshotRedirects(snapshot: SiteSnapshot): SnapshotRedirectValidation {
  const languages = publicLanguages(snapshot.project.languages);
  const defaultLanguage = languages.find((language) => language.isDefault)?.code;
  const routes: RedirectRoute[] = [];
  const routeCollisions = new Set<string>();
  const routeOwners = new Map<string, string>();
  const reserved = ['changelog', 'sitemap.xml', 'robots.txt', 'llms.txt', 'llms-full.txt'];
  const reservedSet = new Set(reserved);

  for (const version of snapshot.project.versions) {
    const versionPages = snapshot.pages.filter((page) => page.versionId === version.id);
    const versionPrefix = version.isDefault ? '' : version.slug;
    for (const language of languages) {
      const ordered = flattenPages(buildNavTree(versionPages, language.code));
      const exact = new Map<string, string>();
      // Exact page lookup in getSitePage is independent of navigation-tree
      // reachability, so a visible page below a hidden parent is still a real
      // route even though it is absent from the sidebar.
      const renderablePages = versionPages.filter((page) => page.languageCode === language.code && page.kind === 'PAGE' && !page.hidden);
      for (const page of renderablePages) {
        const pagePath = normalizeRedirectPath(page.path);
        const routePath = [versionPrefix, pagePath].filter(Boolean).join('/');
        if (exact.has(routePath)) {
          routeCollisions.add(routePath);
        } else {
          exact.set(routePath, routePath);
        }
      }
      const first = ordered[0];
      if (first) {
        const firstPath = [versionPrefix, normalizeRedirectPath(first.path)].filter(Boolean).join('/');
        exact.set(versionPrefix, firstPath);
      }
      // Group/prefix URLs are real published routes (the reader sends a 302 to
      // the first child). Record their final page so redirect destinations can
      // be emitted directly without retaining that extra hop.
      for (const page of ordered) {
        for (const prefix of prefixesOf(normalizeRedirectPath(page.path))) {
          const routePath = [versionPrefix, prefix].filter(Boolean).join('/');
          const canonical = [versionPrefix, normalizeRedirectPath(page.path)].filter(Boolean).join('/');
          if (!exact.has(routePath)) {
            exact.set(routePath, canonical);
          }
        }
      }
      for (const [path, canonicalPath] of exact) {
        const routeKey = `${language.code}:${path}`;
        const owner = routeOwners.get(routeKey);
        if (owner && owner !== version.id) {
          routeCollisions.add(path);
        } else {
          routeOwners.set(routeKey, version.id);
        }
        if (reservedSet.has(path)) {
          routeCollisions.add(path);
        }
        routes.push({ path, canonicalPath, languageCode: language.code });
      }
    }
  }

  const config = snapshot.project.config ?? {};
  const raw = (config as { redirects?: unknown }).redirects;
  const redirects = Array.isArray(raw)
    ? raw.map((redirect, index): RedirectPair => {
        const record = redirect instanceof Object ? (redirect as Partial<RedirectPair>) : {};
        // Preserve malformed legacy rows as an intentionally half-filled rule
        // so validation blocks publication instead of silently dropping data.
        return {
          from: typeof record.from === 'string' ? record.from : `[invalid redirect row ${index + 1}]`,
          to: typeof record.to === 'string' ? record.to : '',
        };
      })
    : [];
  const result = validateRedirectGraph(redirects, {
    routes,
    defaultLanguage,
    enabledLanguages: languages.map((language) => language.code),
    reservedPaths: reserved,
    routeCollisions: [...routeCollisions],
  });
  if (raw !== undefined && !Array.isArray(raw)) {
    result.issues.unshift(issue('malformed-source', 'Stored redirect configuration must be an array of source/destination rules.', [], [], 'from'));
    result.redirects = [];
  }
  if (result.issues.length > 0 || !Array.isArray(raw)) {
    return { ...result, snapshot };
  }
  const nextConfig = { ...config, redirects: result.redirects };
  return { ...result, snapshot: { ...snapshot, project: { ...snapshot.project, config: nextConfig } } };
}

export const summarizeRedirectIssues = (issues: readonly RedirectValidationIssue[]): string => {
  const shown = issues.slice(0, 5).map((entry) => entry.message);
  const suffix = issues.length > shown.length ? ` (+${issues.length - shown.length} more)` : '';
  return `Redirect validation failed (${issues.length}): ${shown.join(' | ')}${suffix}`;
};
