import { posix } from 'node:path';
import { slugify } from '@nibleaf/shared';
import { importSiteHref } from '@nibleaf/shared/site-links';
import { stableHash } from './content';
import { safeDecodeUri as safeDecode } from './gitbook-markdown';
import { decodeImportEntities } from './import-fidelity';
import { protectImportCode } from './import-markdown-code';
import { markdownReferences, replaceImportReferences } from './import-references';
import { type MintlifyLanguageNavigation, type NavNode, partitionMintlifyVersions } from './mintlify-mapping';

const HREF_ATTRIBUTE = /(\bhref\s*=\s*["'])([^"']+)(["'])/gi;

const trimSlashes = (value: string): string => {
  let end = value.length;
  while (value[end - 1] === '/') end--;
  return value.slice(0, end);
};

export const normalizedSourcePath = (value: string): string =>
  posix
    .normalize(trimSlashes(value.replace(/^\/+/, '').replace(/\.(?:md|mdx)$/i, '')))
    .replace(/^\.\//, '')
    .split('/')
    .map(safeDecode)
    .join('/');

/** Build the exact public route each Mintlify navigation page receives after
 * its groups become Nibleaf GROUP pages. The sibling slug ledger mirrors the
 * importer so basename collisions remain deterministic. */
export const buildMintlifyRouteMap = (nodes: readonly NavNode[]): ReadonlyMap<string, string> => {
  const routes = new Map<string, string>();
  const visit = (items: readonly NavNode[], parentSegments: string[]) => {
    const usedSlugs = new Map<string, string>();
    for (const node of items) {
      if (node.kind === 'group') {
        const groupSlug = slugify(node.slug ?? node.title) || `group-${stableHash(node.title)}`;
        visit(node.children, [...parentSegments, groupSlug]);
        continue;
      }
      let leafSlug = slugify(node.path.split('/').pop() ?? node.path) || `page-${stableHash(node.path)}`;
      const prior = usedSlugs.get(leafSlug);
      if (prior && prior !== node.path) leafSlug = slugify(node.path) || `page-${stableHash(node.path)}`;
      usedSlugs.set(leafSlug, node.path);
      routes.set(normalizedSourcePath(node.path), `/${[...parentSegments, leafSlug].join('/')}`);
    }
  };
  visit(nodes, []);
  return routes;
};

/** Foreign navigation supplies destinations without copying translated pages
 * into the current language. Keep version partitions aligned by name. */
export const buildMintlifyLanguageRouteMap = (
  languages: readonly MintlifyLanguageNavigation[],
  currentLanguage: string | undefined,
  versionName: string | undefined,
): ReadonlyMap<string, string> => {
  const routes = new Map<string, string>();
  const languagesByVersion = buildMintlifyLanguageRouteMaps(languages, versionName);
  for (const language of languages) {
    if (language.code.toLowerCase() === currentLanguage?.toLowerCase()) continue;
    for (const [source, destination] of languagesByVersion.get(language.code.toLowerCase()) ?? []) {
      routes.set(source, `${destination}?lang=${encodeURIComponent(language.code)}`);
    }
  }
  return routes;
};

/** Keep language identity until a link's explicit language and current version are known. */
export const buildMintlifyLanguageRouteMaps = (
  languages: readonly MintlifyLanguageNavigation[],
  versionName?: string,
): Map<string, ReadonlyMap<string, string>> => {
  const maps = new Map<string, ReadonlyMap<string, string>>();
  const partitions = languages.map((language) => ({ language, ...partitionMintlifyVersions(language.nodes) }));
  const defaultVersion = partitions.flatMap(({ versions }) => versions).find((version) => version.isDefault)?.name;
  for (const { language, unversioned, versions } of partitions) {
    const version = versions.find((candidate) => (versionName ? candidate.name === versionName : candidate.isDefault));
    const nodes =
      versions.length === 0
        ? !versionName || versionName === defaultVersion
          ? unversioned
          : []
        : version
          ? [...(version.isDefault ? unversioned : []), ...version.nodes]
          : [];
    maps.set(language.code.toLowerCase(), buildMintlifyRouteMap(nodes));
  }
  return maps;
};

const splitSuffix = (reference: string): { path: string; suffix: string } => {
  const index = reference.search(/[?#]/);
  return index === -1 ? { path: reference, suffix: '' } : { path: reference.slice(0, index), suffix: reference.slice(index) };
};

const internalReferenceKey = (reference: string, sourcePage: string): string | null => {
  if (!reference || /^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(reference)) return null;
  const { path } = splitSuffix(reference);
  const sourceDirectory = posix.dirname(normalizedSourcePath(sourcePage));
  return normalizedSourcePath(path.startsWith('/') ? path : posix.join(sourceDirectory === '.' ? '' : sourceDirectory, path));
};

const isAppPage = (reference: string, appOrigins: readonly string[]): boolean => {
  if (!URL.canParse(reference)) return false;
  const url = new URL(reference);
  return appOrigins.includes(url.origin) && url.pathname.startsWith('/pages/');
};

/** Discovery needs the source key; rewriting needs its public destination.
 * Both must prefer an exact destination before source keys and basename aliases. */
const createAppPageLookup = () => {
  type Page = { source: string; target: string };
  const aliases = new Map<ReadonlyMap<string, string>, { exact: Map<string, Page>; basenames: Map<string, Page | null> }>();
  return (map: ReadonlyMap<string, string>, key: string): Page | null | undefined => {
    let bySlug = aliases.get(map);
    if (!bySlug) {
      bySlug = { exact: new Map(), basenames: new Map() };
      for (const [source, target] of map) {
        const path = splitSuffix(target).path;
        const page = { source, target };
        bySlug.exact.set(normalizedSourcePath(path), page);
        const basename = posix.basename(path);
        if (!bySlug.basenames.has(basename)) bySlug.basenames.set(basename, page);
        else if (bySlug.basenames.get(basename)?.target !== target) bySlug.basenames.set(basename, null);
      }
      aliases.set(map, bySlug);
    }
    const sourceTarget = map.get(key);
    return bySlug.exact.get(key) ?? (sourceTarget ? { source: key, target: sourceTarget } : bySlug.basenames.get(key));
  };
};

/** Source-page paths referenced from Markdown or MDX anchors. Used by the
 * importer to include linked hidden pages that Mintlify permits outside nav. */
export const mintlifyInternalLinkTargets = (
  content: string,
  sourcePage: string,
  sourceUrl?: string,
  appOrigins: readonly string[] = ['https://nibleaf.com'],
  languageCode?: string,
  configuredLanguages: readonly string[] = [],
  routes: ReadonlyMap<string, string> = new Map(),
): string[] => {
  const prose = protectImportCode(content).content;
  const languagePrefixes = new Set(configuredLanguages.map((code) => code.toLowerCase()));
  const targets = new Set<string>();
  const appPageTarget = createAppPageLookup();
  const add = (reference: string) => {
    const href = importSiteHref(reference, sourceUrl, appOrigins);
    const key = internalReferenceKey(href, sourcePage);
    if (!key) return;
    if (languageCode) {
      const languages = new URL(href, 'https://import.invalid').searchParams.getAll('lang');
      const prefix = key.split('/')[0]?.toLowerCase() ?? '';
      const current = languageCode.toLowerCase();
      if (languages.length > 1 || (languages.length === 1 && languages[0]?.toLowerCase() !== current)) return;
      if (languagePrefixes.has(prefix) && prefix !== current) return;
    }
    const page = isAppPage(reference, appOrigins) ? appPageTarget(routes, key) : undefined;
    if (page === null) return;
    targets.add(page?.source ?? key);
  };
  for (const reference of markdownReferences(prose)) if (!reference.image) add(reference.value);
  prose.replace(HREF_ATTRIBUTE, (_match, _before: string, reference: string) => {
    add(decodeImportEntities(reference));
    return _match;
  });
  return [...targets];
};

/** Rewrite links between source Mintlify pages to the grouped public routes
 * produced by the import, preserving external URLs, queries, and fragments. */
export const rewriteMintlifyInternalLinks = (
  content: string,
  sourcePage: string,
  routes: ReadonlyMap<string, string>,
  options: {
    sourceUrl?: string;
    appOrigins?: readonly string[];
    onUnresolved?: (reference: string) => void;
    languageCode?: string;
    languageRoutes?: ReadonlyMap<string, ReadonlyMap<string, string>>;
  } = {},
): string => {
  const maps = [routes, ...(options.languageRoutes?.values() ?? [])];
  if (!maps.some((map) => map.size) && !options.onUnresolved) return content;
  if (!content.includes('](') && !content.includes(']:') && !/href/i.test(content)) return content;
  // Basenames also cover relative links and Nibleaf /pages/ aliases. Encoded
  // text and directory-only relative destinations are conservatively parsed.
  const candidate =
    content.includes('%') ||
    content.includes('&') ||
    /(?:\]\(|\]:|href\s*=\s*["'])\s*\.{1,2}(?=[/#?\s)"']|$)/i.test(content) ||
    maps.some((map) =>
      [...map].some(([source, target]) =>
        [source, splitSuffix(target).path].some((path) => {
          const basename = posix.basename(path);
          return basename === '.' ? true : Boolean(basename && content.includes(basename));
        }),
      ),
    );
  // Validation and fidelity reporting must still read real destinations even
  // when the rewrite-only fast path cannot match an imported source.
  if (!candidate && !options.onUnresolved) return content;
  const protectedCode = protectImportCode(content);
  const appPageTarget = createAppPageLookup();
  const rewrite = (original: string): string => {
    const appOrigins = options.appOrigins ?? ['https://nibleaf.com'];
    const reference = importSiteHref(original, options.sourceUrl, appOrigins, options.onUnresolved);
    if (!reference || /^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(reference)) return reference;
    const { suffix } = splitSuffix(reference);
    const key = internalReferenceKey(reference, sourcePage);
    if (!key) return reference;
    const languages = new URL(reference, 'https://import.invalid').searchParams.getAll('lang');
    if (languages.length > 1 || (languages.length === 1 && !languages[0])) {
      options.onUnresolved?.(original);
      return original;
    }
    const requested = languages[0]?.toLowerCase();
    const localized = requested && options.languageRoutes ? options.languageRoutes.get(requested) : undefined;
    const selected =
      requested && options.languageRoutes
        ? localized
        : requested && options.languageCode && requested !== options.languageCode.toLowerCase()
          ? undefined
          : routes;
    const target = selected && (isAppPage(original, appOrigins) ? appPageTarget(selected, key)?.target : selected.get(key));
    if (!target) {
      const path = splitSuffix(reference).path;
      if (!/\.[a-z0-9]{2,8}$/i.test(path) || /\.(?:mdx?|html)$/i.test(path)) options.onUnresolved?.(original);
      return original;
    }
    if (!target.includes('?')) return `${target}${suffix}`;
    const destination = new URL(target, 'https://import.invalid');
    const suffixUrl = new URL(suffix || '/', 'https://import.invalid');
    const params = new URLSearchParams(suffixUrl.search);
    for (const [name, value] of destination.searchParams) params.set(name, value);
    return `${destination.pathname}?${params}${suffixUrl.hash}`;
  };
  const markdown = replaceImportReferences(
    protectedCode.content,
    markdownReferences(protectedCode.content).filter((reference) => !reference.image),
    (reference) => rewrite(reference.value),
  );
  return protectedCode.restore(
    markdown.replace(HREF_ATTRIBUTE, (match, before: string, reference: string, after: string) => {
      const decoded = decodeImportEntities(reference);
      const rewritten = rewrite(decoded);
      if (rewritten === decoded) return match;
      const escaped = rewritten
        .replaceAll('&', '&amp;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
      return `${before}${escaped}${after}`;
    }),
  );
};
