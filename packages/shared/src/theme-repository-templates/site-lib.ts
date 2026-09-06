import type { ThemeRepositoryTemplateOptions } from './types';

/** `src/lib/site.ts`: reads docs.json and every MDX file under the content
 * root, builds navigation (docs.json order first, unlisted files appended —
 * fumadocs "rest" semantics), and resolves language/version from the URL. */
export const siteLibTemplate = ({ contentRoot }: ThemeRepositoryTemplateOptions): string => {
  const prefix = `../../${contentRoot ? `${contentRoot}/` : ''}`;
  return String.raw`import docsJson from '../../docs.json';

export interface SiteLanguage {
  code: string;
  label: string;
  direction: 'LTR' | 'RTL';
  isDefault: boolean;
  /** Disabled languages keep their files resolvable but are hidden from the switcher. */
  enabled?: boolean;
  /** Content sub-directory relative to the content root; empty for the default language. */
  directory: string;
}

export interface SiteVersion {
  id: string;
  name: string;
  slug: string;
  isDefault: boolean;
  /** Content sub-directory relative to the content root; empty for the default version. */
  directory: string;
}

export interface SiteTheme {
  id: string;
  metadata: { name: string; description: string; author?: string };
  colors: { light: Record<string, string>; dark: Record<string, string> };
  layout: {
    shell: 'reference' | 'editorial' | 'console';
    density: string;
    radius: string;
    contentWidth: string;
    header: string;
    sidebar: string;
    navigation: string;
  };
  components: Record<string, string>;
}

export interface SitePage {
  /** Path relative to the content root without extension, e.g. "ar/guides/auth". */
  file: string;
  /** URL path; "index" files resolve to their folder. */
  route: string;
  language: string;
  version: string;
  title: string;
  description?: string;
  icon?: string;
  hidden: boolean;
  body: string;
}

export type NavItem = { kind: 'page'; page: SitePage } | { kind: 'group'; title: string; icon?: string; items: NavItem[] };
export interface SiteScope {
  language: SiteLanguage;
  version: SiteVersion;
  relative: string;
}
export interface Heading {
  depth: 2 | 3;
  text: string;
  id: string;
}

interface DocsGroup {
  group: string;
  icon?: string;
  pages?: DocsNavEntry[];
}
type DocsNavEntry = string | DocsGroup;
interface DocsLanguageNav {
  language: string;
  pages?: DocsNavEntry[];
}
interface DocsVersionNav {
  version: string;
  'x-nibleaf'?: { slug?: string };
  languages?: DocsLanguageNav[];
}
interface DocsConfig {
  name: string;
  description?: string;
  navigation: { languages?: DocsLanguageNav[]; versions?: DocsVersionNav[] };
  'x-nibleaf': {
    theme: SiteTheme;
    appearance: 'light' | 'dark' | 'system';
    languages: SiteLanguage[];
    versions: SiteVersion[];
    contentPath: string;
  };
}

const docs = docsJson as unknown as DocsConfig;
const CONTENT_PREFIX = '${prefix}';
const sources = import.meta.glob('${prefix}**/*.mdx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export const languages: SiteLanguage[] = docs['x-nibleaf'].languages;
export const versions: SiteVersion[] = docs['x-nibleaf'].versions;
const defaultLanguage = languages.find((item) => item.isDefault) ?? languages[0];
const defaultVersion = versions.find((item) => item.isDefault) ?? versions[0];
if (!(defaultLanguage && defaultVersion)) throw new Error('docs.json must declare at least one language and one version.');

const parseScalar = (raw: string): string | boolean => {
  const value = raw.trim();
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return String(JSON.parse(value));
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  return value;
};

/** Minimal YAML frontmatter reader for the keys Nibleaf writes (title,
 * description, icon, hidden). Unknown keys are kept as plain strings. */
export const parseFrontmatter = (source: string): { meta: Record<string, string | boolean>; body: string } => {
  const normalized = source.replace(/\r\n?/g, '\n');
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(normalized);
  if (!match) return { meta: {}, body: normalized };
  const meta: Record<string, string | boolean> = {};
  for (const line of (match[1] ?? '').split('\n')) {
    const entry = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (entry?.[1] !== undefined) meta[entry[1]] = parseScalar(entry[2] ?? '');
  }
  return { meta, body: normalized.slice(match[0].length).replace(/^\n+/, '') };
};

const decodeSafe = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

export const humanize = (segment: string): string => {
  const text = decodeSafe(segment).replace(/[-_]+/g, ' ').trim();
  return text ? text.charAt(0).toLocaleUpperCase() + text.slice(1) : segment;
};

/** Resolve language and version from a content-root-relative path (no extension). */
export const scopeFor = (file: string): SiteScope => {
  let segments = file.split('/').filter(Boolean);
  let version = defaultVersion;
  let language = defaultLanguage;
  if (segments[0] === 'versions' && segments.length > 1) {
    const match = versions.find((item) => !item.isDefault && item.directory === 'versions/' + segments[1]);
    if (match) {
      version = match;
      segments = segments.slice(2);
    }
  }
  const languageMatch = languages.find((item) => !item.isDefault && item.directory === segments[0]);
  if (languageMatch) {
    language = languageMatch;
    segments = segments.slice(1);
  }
  return { language, version, relative: segments.join('/') };
};

const routeFor = (file: string): string => {
  const trimmed = file === 'index' ? '' : file.endsWith('/index') ? file.slice(0, -'/index'.length) : file;
  return '/' + trimmed;
};

const buildPage = (modulePath: string, source: string): SitePage => {
  const file = modulePath.slice(CONTENT_PREFIX.length).replace(/\.mdx$/, '');
  const { meta, body } = parseFrontmatter(source);
  const scope = scopeFor(file);
  const segments = file.split('/');
  const last = segments[segments.length - 1] ?? file;
  const leaf = last === 'index' ? (segments[segments.length - 2] ?? docs.name) : last;
  return {
    file,
    route: routeFor(file),
    language: scope.language.code,
    version: scope.version.slug,
    title: typeof meta.title === 'string' && meta.title ? meta.title : humanize(leaf),
    description: typeof meta.description === 'string' && meta.description ? meta.description : undefined,
    icon: typeof meta.icon === 'string' && meta.icon ? meta.icon : undefined,
    hidden: meta.hidden === true,
    body,
  };
};

export const pages: SitePage[] = Object.entries(sources)
  .map(([path, source]) => buildPage(path, source))
  .sort((a, b) => a.file.localeCompare(b.file, 'en'));
const pageByFile = new Map(pages.map((page) => [page.file, page]));

export const normalizeRoute = (pathname: string): string => '/' + decodeSafe(pathname).replace(/^\/+|\/+$/g, '');
export const pageForRoute = (pathname: string): SitePage | undefined => {
  const route = normalizeRoute(pathname);
  return pages.find((page) => page.route === route);
};
export const scopeForRoute = (pathname: string): SiteScope => scopeFor(normalizeRoute(pathname).slice(1));
export const htmlAttributes = (pathname: string): { lang: string; dir: 'ltr' | 'rtl' } => {
  const { language } = scopeForRoute(pathname);
  return { lang: language.code, dir: language.direction === 'RTL' ? 'rtl' : 'ltr' };
};

const navEntriesFor = (language: SiteLanguage, version: SiteVersion): DocsNavEntry[] => {
  const versionNav = docs.navigation.versions?.find((item) => item['x-nibleaf']?.slug === version.slug);
  const list = versionNav ? (versionNav.languages ?? []) : (docs.navigation.languages ?? []);
  return list.find((item) => item.language === language.code)?.pages ?? [];
};

const itemsFromEntries = (entries: DocsNavEntry[], seen: Set<string>): NavItem[] =>
  entries.flatMap((entry): NavItem[] => {
    if (typeof entry === 'string') {
      const page = pageByFile.get(entry);
      if (!page || page.hidden) return [];
      seen.add(page.file);
      return [{ kind: 'page', page }];
    }
    return [{ kind: 'group', title: entry.group, icon: entry.icon, items: itemsFromEntries(entry.pages ?? [], seen) }];
  });

type NavGroup = Extract<NavItem, { kind: 'group' }>;

/** A file that docs.json does not list yet lands in the group derived from its
 * folder, so the site keeps working while Nibleaf catches up. */
const appendUnlisted = (items: NavItem[], page: SitePage): void => {
  const folders = scopeFor(page.file).relative.split('/');
  folders.pop();
  let level = items;
  for (const folder of folders) {
    const title = humanize(folder);
    let group = level.find((item): item is NavGroup => item.kind === 'group' && item.title === title);
    if (!group) {
      group = { kind: 'group', title, items: [] };
      level.push(group);
    }
    level = group.items;
  }
  level.push({ kind: 'page', page });
};

export const navFor = (language: SiteLanguage, version: SiteVersion): NavItem[] => {
  const seen = new Set<string>();
  const items = itemsFromEntries(navEntriesFor(language, version), seen);
  for (const page of pages) {
    if (page.language !== language.code || page.version !== version.slug || page.hidden || seen.has(page.file)) continue;
    appendUnlisted(items, page);
  }
  return items;
};

export const flattenNav = (items: NavItem[]): SitePage[] => items.flatMap((item) => (item.kind === 'page' ? [item.page] : flattenNav(item.items)));
export const firstPage = (language: SiteLanguage, version: SiteVersion): SitePage | undefined => flattenNav(navFor(language, version))[0];

export const siblings = (page: SitePage): { previous?: SitePage; next?: SitePage } => {
  const scope = scopeFor(page.file);
  const list = flattenNav(navFor(scope.language, scope.version));
  const index = list.findIndex((item) => item.file === page.file);
  return { previous: index > 0 ? list[index - 1] : undefined, next: index >= 0 ? list[index + 1] : undefined };
};

export const routeForScope = (language: SiteLanguage, version: SiteVersion): string => '/' + [version.directory, language.directory].filter(Boolean).join('/');

/** Best route to open when switching language or version: the same relative
 * page when it exists, otherwise the first page of that scope. */
export const counterpartRoute = (page: SitePage | null, language: SiteLanguage, version: SiteVersion): string => {
  if (page) {
    const relative = scopeFor(page.file).relative;
    const match = pages.find(
      (item) => item.language === language.code && item.version === version.slug && !item.hidden && scopeFor(item.file).relative === relative,
    );
    if (match) return match.route;
  }
  return firstPage(language, version)?.route ?? routeForScope(language, version);
};

export const searchPages = (query: string, language: SiteLanguage, version: SiteVersion, limit = 8): SitePage[] => {
  const needle = query.trim().toLocaleLowerCase(language.code);
  if (!needle) return [];
  return pages
    .filter(
      (page) =>
        page.language === language.code &&
        page.version === version.slug &&
        !page.hidden &&
        [page.title, page.description ?? '', page.body].join('\n').toLocaleLowerCase(language.code).includes(needle),
    )
    .slice(0, limit);
};

export const slugifyHeading = (text: string): string =>
  text
    .toLocaleLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-') || 'section';

export const uniqueHeadingId = (text: string, used: Map<string, number>): string => {
  const base = slugifyHeading(text);
  const count = used.get(base) ?? 0;
  used.set(base, count + 1);
  return count === 0 ? base : base + '-' + count;
};

const inlineText = (markdown: string): string =>
  markdown
    .replace(/\x60([^\x60]*)\x60/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_~]+/g, '')
    .trim();

/** Headings for the page outline; ids match the ones the Markdown renderer emits. */
export const extractHeadings = (body: string): Heading[] => {
  const used = new Map<string, number>();
  const headings: Heading[] = [];
  let fence: string | null = null;
  for (const line of body.split('\n')) {
    const fenceMatch = /^\s*(\x60{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const marker = (fenceMatch[1] ?? '').charAt(0);
      if (fence === null) fence = marker;
      else if (marker === fence) fence = null;
      continue;
    }
    if (fence) continue;
    const match = /^(#{2,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match) continue;
    const text = inlineText(match[2] ?? '');
    headings.push({ depth: match[1]?.length === 2 ? 2 : 3, text, id: uniqueHeadingId(text, used) });
  }
  return headings;
};

export const chromeLocale = (code: string): 'en' | 'ar' => (code === 'ar' || code.startsWith('ar-') ? 'ar' : 'en');

export const site = {
  name: docs.name,
  description: docs.description ?? '',
  theme: docs['x-nibleaf'].theme,
  appearance: docs['x-nibleaf'].appearance,
  languages,
  versions,
  defaultLanguage,
  defaultVersion,
};
`;
};

export const siteLibTestTemplate = (): string => String.raw`import { describe, expect, it } from 'vitest';
import { extractHeadings, flattenNav, navFor, pageForRoute, pages, parseFrontmatter, scopeForRoute, site } from './site';

const fence = '\x60\x60\x60';

describe('site content', () => {
  it('loads every MDX page and resolves it back from its route', () => {
    expect(pages.length).toBeGreaterThan(0);
    for (const page of pages) expect(pageForRoute(page.route)?.file).toBe(page.file);
  });

  it('lists every visible page in the navigation of its language and version', () => {
    for (const language of site.languages) {
      for (const version of site.versions) {
        const listed = new Set(flattenNav(navFor(language, version)).map((page) => page.file));
        for (const page of pages) {
          if (page.language === language.code && page.version === version.slug && !page.hidden) expect(listed.has(page.file)).toBe(true);
        }
      }
    }
  });

  it('resolves the default language at the root and other languages by prefix', () => {
    expect(scopeForRoute('/').language.code).toBe(site.defaultLanguage.code);
    for (const language of site.languages) expect(scopeForRoute('/' + language.directory).language.code).toBe(language.code);
  });

  it('parses frontmatter and skips fenced code when collecting headings', () => {
    const parsed = parseFrontmatter('---\ntitle: "Hello"\nhidden: true\n---\n\n## First\n\n' + fence + 'ts\n## not a heading\n' + fence + '\n\n### Second');
    expect(parsed.meta).toEqual({ title: 'Hello', hidden: true });
    expect(extractHeadings(parsed.body)).toEqual([
      { depth: 2, text: 'First', id: 'first' },
      { depth: 3, text: 'Second', id: 'second' },
    ]);
  });
});
`;
