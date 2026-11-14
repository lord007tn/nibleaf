// Pinned link-rewrite oracle from main f8e1f166. Test-only; do not use in production.
import { posix } from 'node:path';
import { importSiteHref } from '@nibleaf/shared/site-links';
import { safeDecodeUri as safeDecode } from '../gitbook-markdown';
import { decodeImportEntities } from '../import-fidelity';
import { protectImportCode } from '../import-markdown-code';
import { markdownReferences, replaceImportReferences } from '../import-references';

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

/** Rewrite links between source Mintlify pages to the grouped public routes
 * produced by the import, preserving external URLs, queries, and fragments. */
export const rewriteMainInternalLinks = (
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
