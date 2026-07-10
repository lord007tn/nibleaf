import GithubSlugger from 'github-slugger';
import { excerpt } from './utils';

/** Per-page SEO + behaviour overrides baked into the snapshot. Mirrors
 *  `pageConfigSchema` in @nibleaf/validators (kept inline to avoid a dep). */
export interface SnapshotPageConfig {
  seo?: { metaTitle?: string; metaDescription?: string; ogImage?: string; canonicalUrl?: string; noindex?: boolean };
  sidebarTitle?: string;
  tag?: string;
  mode?: 'default' | 'wide' | 'center';
  hideToc?: boolean;
}

/** Per-language SEO overrides baked into the snapshot. */
export interface SnapshotLanguageConfig {
  seo?: { metaTitle?: string; metaDescription?: string; socialImage?: string; allowIndex?: boolean };
}

export interface SnapshotPage {
  id: string;
  parentId: string | null;
  versionId: string;
  updatedAt: string;
  languageCode: string;
  kind: 'PAGE' | 'GROUP';
  title: string;
  slug: string;
  path: string;
  icon: string | null;
  description: string | null;
  content: string;
  config: SnapshotPageConfig | null;
  /** Links this page to its translations in other languages (see Page.translationKey). */
  translationKey: string | null;
  position: number;
  hidden: boolean;
}

export interface SnapshotLanguage {
  code: string;
  label: string;
  direction: 'LTR' | 'RTL';
  isDefault: boolean;
  config: SnapshotLanguageConfig | null;
}

export interface SnapshotVersion {
  id: string;
  name: string;
  slug: string;
  isDefault: boolean;
}

export interface SnapshotProject {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  config: Record<string, unknown> | null;
  languages: SnapshotLanguage[];
  versions: SnapshotVersion[];
}

export interface SiteSnapshot {
  project: SnapshotProject;
  pages: SnapshotPage[];
  generatedAt: string;
}

/** Return the project slug for `<slug>.<baseDomain>` hosts. Custom domains and
 *  nested hosts intentionally return null; they are resolved separately. */
export const projectSlugFromSubdomainHost = (host: string, baseDomain?: string | null): string | null => {
  const cleanHost = (host ?? '').toLowerCase().split(':')[0]?.trim().replace(/\.$/, '');
  const cleanBase = (baseDomain ?? '').toLowerCase().trim().replace(/^\*\./, '').replace(/\.$/, '');
  if (!cleanHost || !cleanBase || cleanHost === cleanBase || !cleanHost.endsWith(`.${cleanBase}`)) {
    return null;
  }
  const slug = cleanHost.slice(0, -(cleanBase.length + 1));
  return slug && !slug.includes('.') ? slug : null;
};

/** The one default language required by the snapshot contract. */
export const defaultLanguage = (project: SnapshotProject): SnapshotLanguage => {
  const defaults = project.languages.filter((language) => language.isDefault);
  if (defaults.length !== 1 || !defaults[0]) {
    throw new Error(`Snapshot project ${project.id} must have exactly one default language.`);
  }
  return defaults[0];
};

/** A node in the rendered navigation tree (groups contain children). */
export interface NavNode {
  id: string;
  kind: 'PAGE' | 'GROUP';
  title: string;
  path: string;
  icon: string | null;
  tag: string | null;
  children: NavNode[];
}

/** Build a navigation tree from snapshot pages, hiding pages flagged `hidden`.
 *  When `languageCode` is given, only that language's pages are included. */
export const buildNavTree = (pages: SnapshotPage[], languageCode?: string): NavNode[] => {
  const visible = pages.filter((p) => !p.hidden && (!languageCode || p.languageCode === languageCode));
  const byParent = new Map<string | null, SnapshotPage[]>();
  for (const page of visible) {
    const list = byParent.get(page.parentId) ?? [];
    list.push(page);
    byParent.set(page.parentId, list);
  }
  const build = (parentId: string | null): NavNode[] =>
    (byParent.get(parentId) ?? [])
      .sort((a, b) => a.position - b.position)
      .map((page) => ({
        id: page.id,
        kind: page.kind,
        // Mintlify-style: a short sidebar label overrides the full page title in nav.
        title: page.config?.sidebarTitle?.trim() || page.title,
        path: page.path,
        icon: page.icon,
        tag: page.config?.tag?.trim() || null,
        children: build(page.id),
      }));
  return build(null);
};

const HEADING = /^(#{1,4})\s+(.+?)\s*#*$/;

export interface Heading {
  depth: number;
  text: string;
  id: string;
}

/** Reduce an inline-Markdown heading to the plain text the renderer produces, so
 *  the slug we compute matches the DOM id (rehype-slug slugs the rendered text
 *  content). Without this, a heading like `## See [the guide](/x)` or
 *  `## The _fast_ path` gets a different id than the anchor, breaking the TOC and
 *  deep links. */
const stripInlineMarkdown = (text: string): string =>
  text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // images render as <img> — no text content
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links → their text
    .replace(/`([^`]+)`/g, '$1') // inline code
    .replace(/(\*\*|__)(.*?)\1/g, '$2') // bold
    .replace(/(\*|_)(.*?)\1/g, '$2') // italic
    .replace(/~~(.*?)~~/g, '$2') // strikethrough
    .trim();

/** Extract markdown headings (h1–h4) with slug ids — powers search + the TOC.
 *  Ids are produced with github-slugger, the same slugger rehype-slug uses to
 *  set DOM ids, so TOC anchors resolve for Unicode (e.g. Arabic) headings and
 *  duplicate headings get matching -1/-2 suffixes on both sides. */
export const extractHeadings = (markdown: string): Heading[] => {
  const headings: Heading[] = [];
  const slugger = new GithubSlugger();
  let inFence = false;
  for (const line of markdown.split('\n')) {
    if (line.trimStart().startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      continue;
    }
    const match = HEADING.exec(line);
    if (match) {
      const text = stripInlineMarkdown(match[2]?.trim() ?? '');
      headings.push({
        depth: match[1]?.length ?? 1,
        text,
        id: slugger.slug(text),
      });
    }
  }
  return headings;
};

/** Build a one-line description for a page (its own, or derived from content). */
export const pageDescription = (page: Pick<SnapshotPage, 'description' | 'content'>): string => page.description?.trim() || excerpt(page.content);

/** Replace Mintlify-style `{{ key }}` content variables with their configured
 *  values at snapshot-build time. Tokens whose key isn't defined are left intact
 *  (rather than failing the build) so a typo never blanks out content. Dotted and
 *  hyphenated keys (e.g. `{{ api.version }}`) are supported. */
export const interpolateVariables = (text: string, variables: Record<string, string>): string => {
  if (!text || Object.keys(variables).length === 0) {
    return text;
  }
  return text.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (whole, key: string) => (Object.hasOwn(variables, key) ? (variables[key] ?? whole) : whole));
};

/** Extract a `{ key: value }` map from a project config's `variables` array. */
const variablesFromConfig = (config: unknown): Record<string, string> => {
  const list = (config as { variables?: Array<{ key?: unknown; value?: unknown }> } | null)?.variables;
  const map: Record<string, string> = {};
  if (Array.isArray(list)) {
    for (const item of list) {
      if (typeof item?.key === 'string' && item.key && typeof item?.value === 'string') {
        map[item.key] = item.value;
      }
    }
  }
  return map;
};

const versionSlug = (name: string, fallback: string): string => {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
};

const uniqueVersionSlug = (name: string, fallback: string, used: Set<string>): string => {
  const base = versionSlug(name, fallback);
  let candidate = base;
  if (used.has(candidate)) {
    const suffix = versionSlug(fallback, fallback).slice(0, 12) || 'version';
    candidate = `${base}-${suffix}`;
  }
  let n = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${n}`;
    n += 1;
  }
  used.add(candidate);
  return candidate;
};

type LanguageRow = { code: string; label: string; direction: 'LTR' | 'RTL'; isDefault: boolean; config: unknown };
type BranchRow = { id: string; name: string; isDefault: boolean };
type ProjectRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  config: unknown;
  languages: LanguageRow[];
  branches: BranchRow[];
};
type PageRow = Omit<SnapshotPage, 'config' | 'versionId'> & {
  config: unknown;
  branchId: string;
};

/** Compose an immutable site snapshot from a project + its pages (publish time). */
export const buildSnapshot = (project: ProjectRow, pages: PageRow[], generatedAt: string): SiteSnapshot => {
  const languages: SnapshotLanguage[] = project.languages.map((l) => ({
    code: l.code,
    label: l.label,
    direction: l.direction,
    isDefault: l.isDefault,
    config: (l.config as SnapshotLanguageConfig | null) ?? null,
  }));
  const defaultLanguages = languages.filter((language) => language.isDefault);
  if (languages.length === 0 || defaultLanguages.length !== 1) {
    throw new Error(`Project ${project.id} must have exactly one default language before publishing.`);
  }
  const branchRows = project.branches;
  if (branchRows.length === 0) {
    throw new Error(`Project ${project.id} must have a branch before publishing.`);
  }
  const usedVersionSlugs = new Set<string>();
  const versions: SnapshotVersion[] = branchRows.map((branch) => ({
    id: branch.id,
    name: branch.name,
    slug: uniqueVersionSlug(branch.name, branch.id, usedVersionSlugs),
    isDefault: branch.isDefault,
  }));
  if (versions.filter((version) => version.isDefault).length !== 1) {
    throw new Error(`Project ${project.id} must have exactly one default branch before publishing.`);
  }
  const versionById = new Map(versions.map((version) => [version.id, version]));
  // Resolve Mintlify-style `{{ variables }}` once, then bake the substituted text
  // into the snapshot so the live site, search index and SEO all see final values.
  const variables = variablesFromConfig(project.config);
  return {
    project: {
      id: project.id,
      name: project.name,
      slug: project.slug,
      description: project.description,
      icon: project.icon,
      config: (project.config as Record<string, unknown> | null) ?? null,
      languages,
      versions,
    },
    pages: pages.map((page) => {
      const version = versionById.get(page.branchId);
      if (!version) {
        throw new Error(`Page ${page.id} references a branch outside project ${project.id}.`);
      }
      return {
        id: page.id,
        parentId: page.parentId,
        versionId: version.id,
        updatedAt: page.updatedAt,
        languageCode: page.languageCode,
        kind: page.kind,
        title: interpolateVariables(page.title, variables),
        slug: page.slug,
        path: page.path,
        icon: page.icon,
        description: page.description ? interpolateVariables(page.description, variables) : page.description,
        content: interpolateVariables(page.content, variables),
        config: (page.config as SnapshotPageConfig | null) ?? null,
        translationKey: page.translationKey,
        position: page.position,
        hidden: page.hidden,
      };
    }),
    generatedAt,
  };
};
