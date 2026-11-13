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

const normalizedSourcePath = (value: string): string =>
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

/** Source-page paths referenced from Markdown or MDX anchors. Used by the
 * importer to include linked hidden pages that Mintlify permits outside nav. */
export const mintlifyInternalLinkTargets = (
  content: string,
  sourcePage: string,
  sourceUrl?: string,
  appOrigins: readonly string[] = ['https://nibleaf.com'],
  languageCode?: string,
  configuredLanguages: readonly string[] = [],
): string[] => {
  const prose = protectImportCode(content).content;
  const languagePrefixes = new Set(configuredLanguages.map((code) => code.toLowerCase()));
  const targets = new Set<string>();
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
    targets.add(key);
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
  const protectedCode = protectImportCode(content);
  const aliases = new Map<ReadonlyMap<string, string>, { exact: Map<string, string>; basenames: Map<string, string | null> }>();
  const appPageTarget = (map: ReadonlyMap<string, string>, key: string): string | undefined => {
    let bySlug = aliases.get(map);
    if (!bySlug) {
      bySlug = { exact: new Map(), basenames: new Map() };
      for (const target of map.values()) {
        const path = splitSuffix(target).path;
        bySlug.exact.set(normalizedSourcePath(path), target);
        const basename = posix.basename(path);
        bySlug.basenames.set(basename, bySlug.basenames.has(basename) && bySlug.basenames.get(basename) !== target ? null : target);
      }
      aliases.set(map, bySlug);
    }
    return bySlug.exact.get(key) ?? map.get(key) ?? bySlug.basenames.get(key) ?? undefined;
  };
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
    const appPage = URL.canParse(original) && appOrigins.includes(new URL(original).origin) && new URL(original).pathname.startsWith('/pages/');
    const target = selected && (appPage ? appPageTarget(selected, key) : selected.get(key));
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
