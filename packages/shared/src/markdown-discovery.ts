/**
 * llms.txt v2 discovery helpers.
 *
 * Human pages keep their canonical URL. Their Markdown representation uses a
 * stable `.md` sibling (`/guide` -> `/guide.md`, `/` -> `/index.md`). Both
 * representations advertise the Markdown alternate and the nearest llms.txt
 * index through standard link relations.
 */

const withoutTrailingSlashes = (value: string): string => {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) end -= 1;
  return value.slice(0, end);
};

const withoutBoundarySlashes = (value: string): string => {
  let start = 0;
  let end = value.length;
  while (start < end && value.charCodeAt(start) === 47) start += 1;
  while (end > start && value.charCodeAt(end - 1) === 47) end -= 1;
  return value.slice(start, end);
};

const cleanPathname = (pathname: string): string => {
  const withLeadingSlash = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return withLeadingSlash.length > 1 ? withoutTrailingSlashes(withLeadingSlash) : withLeadingSlash;
};

/** Decode each routed path segment exactly once before passing it to a page
 * lookup. A malformed escape is rejected instead of being forwarded as a
 * different literal path. */
export const decodePublishedPathname = (pathname: string): string | null => {
  try {
    return pathname
      .split('/')
      .map((segment) => decodeURIComponent(segment))
      .join('/');
  } catch {
    return null;
  }
};

export const markdownAliasPath = (pathname: string): string => {
  const clean = cleanPathname(pathname);
  return clean === '/' ? '/index.md' : `${clean}.md`;
};

export const canonicalPathFromMarkdownAlias = (pathname: string): string | null => {
  const clean = cleanPathname(pathname);
  if (clean === '/index.md') return '/';
  if (!clean.endsWith('.md') || clean.endsWith('.html.md')) return null;
  const canonical = clean.slice(0, -3);
  return canonical || '/';
};

export const markdownAlternateUrl = (canonicalUrl: string): string => {
  const alternate = new URL(canonicalUrl);
  alternate.pathname = markdownAliasPath(alternate.pathname);
  alternate.hash = '';
  return alternate.toString();
};

export const markdownDiscoveryLinkHeader = (canonicalUrl: string, llmsUrl: string): string =>
  `<${markdownAlternateUrl(canonicalUrl)}>; rel="alternate"; type="text/markdown", <${llmsUrl}>; rel="describedby"`;

/** Join a canonical site base that may itself contain a path (`/sites/:id`). */
export const documentUrlForBase = (base: string, pathname: string, search = ''): string => {
  const normalizedBase = withoutTrailingSlashes(base);
  const normalizedPath = pathname === '/' ? '' : `/${withoutBoundarySlashes(pathname)}`;
  return `${normalizedBase}${normalizedPath}${search}`;
};
