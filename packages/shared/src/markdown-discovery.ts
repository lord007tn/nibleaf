/**
 * llms.txt v2 discovery helpers.
 *
 * Human pages keep their canonical URL. Their Markdown representation uses a
 * stable `.md` sibling (`/guide` -> `/guide.md`, `/` -> `/index.md`). Both
 * representations advertise the Markdown alternate and the nearest llms.txt
 * index through standard link relations.
 */

const cleanPathname = (pathname: string): string => {
  const withLeadingSlash = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return withLeadingSlash.length > 1 ? withLeadingSlash.replace(/\/+$/u, '') : withLeadingSlash;
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
  const normalizedBase = base.replace(/\/+$/u, '');
  const normalizedPath = pathname === '/' ? '' : `/${pathname.replace(/^\/+|\/+$/gu, '')}`;
  return `${normalizedBase}${normalizedPath}${search}`;
};
