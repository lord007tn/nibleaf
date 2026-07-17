import { slugify } from '@nibleaf/shared';
import { type ProjectConfig, projectConfigSchema } from '@nibleaf/validators';

/**
 * Pure mapping logic for the Mintlify importer: locate the config file,
 * normalize `docs.json` (2024+ schema) / `mint.json` (legacy) navigation into
 * a page tree, and translate site chrome into our `ProjectConfig` shape.
 * No prisma / fetch / `@/…` imports so unit tests run without a database.
 */

// ─── Navigation model ────────────────────────────────────────────────────────

export interface NavGroupNode {
  kind: 'group';
  title: string;
  icon?: string;
  /** Which schema construct produced this group (tabs/anchors become groups too). */
  origin: 'group' | 'tab' | 'anchor' | 'dropdown' | 'language' | 'version' | 'menu';
  children: NavNode[];
}

export interface NavPageNode {
  kind: 'page';
  /** Repo-relative page path without extension, e.g. `guides/quickstart`. */
  path: string;
}

export type NavNode = NavGroupNode | NavPageNode;

export interface MintlifyNavResult {
  nodes: NavNode[];
  warnings: string[];
}

type Dict = Record<string, unknown>;

const isDict = (value: unknown): value is Dict => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const asString = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
const isExternalUrl = (value: string): boolean => /^https?:\/\//i.test(value);

/** docs.json container kinds, in the order Mintlify nests them. */
const CONTAINERS = [
  { list: 'languages', label: 'language', origin: 'language' },
  { list: 'versions', label: 'version', origin: 'version' },
  { list: 'tabs', label: 'tab', origin: 'tab' },
  { list: 'dropdowns', label: 'dropdown', origin: 'dropdown' },
  { list: 'anchors', label: 'anchor', origin: 'anchor' },
  { list: 'menus', label: 'menu', origin: 'menu' },
] as const;

const normalizePagePath = (value: string): string =>
  value
    .trim()
    .replace(/^\.?\//, '')
    .replace(/\.(mdx?|md)$/i, '');

/** Entries of a `pages` array: page paths, nested groups, or (rarely) containers. */
const parsePagesArray = (entries: unknown, warnings: string[]): NavNode[] => {
  if (!Array.isArray(entries)) {
    return [];
  }
  const nodes: NavNode[] = [];
  for (const entry of entries) {
    if (typeof entry === 'string') {
      if (isExternalUrl(entry)) {
        warnings.push(`Skipped external navigation link "${entry}".`);
        continue;
      }
      const path = normalizePagePath(entry);
      if (path) {
        nodes.push({ kind: 'page', path });
      }
      continue;
    }
    if (isDict(entry)) {
      nodes.push(...parseContainerObject(entry, warnings));
      continue;
    }
    warnings.push('Skipped an unrecognized navigation entry.');
  }
  return nodes;
};

/** Resolve every nested division of a docs.json container object, in schema order. */
const resolveDivisions = (container: Dict, warnings: string[]): NavNode[] => {
  const nodes: NavNode[] = [];
  for (const { list, label, origin } of CONTAINERS) {
    const items = container[list];
    if (!Array.isArray(items)) {
      continue;
    }
    for (const item of items) {
      if (!isDict(item)) {
        continue;
      }
      const title = asString(item[label]);
      const href = asString(item.href) ?? asString(item.url);
      const children = resolveDivisions(item, warnings);
      if (children.length === 0) {
        if (href) {
          // Link-only anchors/tabs point at external targets — they belong in
          // the navbar (handled by the config mapping), not the page tree.
          continue;
        }
        warnings.push(`Navigation ${label} "${title ?? '(unnamed)'}" has no pages and was skipped.`);
        continue;
      }
      if (origin === 'language' || origin === 'version') {
        warnings.push(`Navigation ${label} "${title ?? '(unnamed)'}" was imported as a top-level group.`);
      }
      nodes.push({ kind: 'group', title: title ?? 'Untitled', origin, children });
    }
  }
  const groups = container.groups;
  if (Array.isArray(groups)) {
    for (const item of groups) {
      if (isDict(item)) {
        nodes.push(...parseContainerObject(item, warnings));
      }
    }
  }
  nodes.push(...parsePagesArray(container.pages, warnings));
  return nodes;
};

/** One object entry — a `{ group: … }` node or a bare container wrapper. */
const parseContainerObject = (entry: Dict, warnings: string[]): NavNode[] => {
  const groupTitle = asString(entry.group);
  const children = resolveDivisions(entry, warnings);
  if (groupTitle) {
    if (children.length === 0) {
      warnings.push(`Navigation group "${groupTitle}" has no pages and was skipped.`);
      return [];
    }
    return [{ kind: 'group', title: groupTitle, origin: 'group', icon: asString(entry.icon), children }];
  }
  return children;
};

/**
 * Normalize either schema's `navigation` into an ordered tree.
 * - mint.json: an array of `{ group, pages: [path | nested group] }`.
 * - docs.json: an object of nested containers (languages/versions/tabs/anchors/
 *   dropdowns/groups/pages). Tabs, anchors, languages, and versions become
 *   top-level groups so the hierarchy survives the import.
 */
export const parseMintlifyNavigation = (config: Dict): MintlifyNavResult => {
  const warnings: string[] = [];
  const navigation = config.navigation;
  if (Array.isArray(navigation)) {
    const nodes: NavNode[] = [];
    // Legacy versioned navigation: mint.json entries carrying a `version`
    // string usually repeat the same group titles per version ("Guides" in v1
    // AND v2), which would merge into one group on import. Wrap each version's
    // entries under a synthetic per-version group (created once per distinct
    // version, in first-seen order) so the versions stay separate.
    const versionGroups = new Map<string, NavGroupNode>();
    for (const entry of navigation) {
      if (!isDict(entry)) {
        continue;
      }
      const parsed = parseContainerObject(entry, warnings);
      if (parsed.length === 0) {
        continue;
      }
      const version = asString(entry.version);
      if (!version) {
        nodes.push(...parsed);
        continue;
      }
      let wrapper = versionGroups.get(version);
      if (!wrapper) {
        wrapper = { kind: 'group', title: version, origin: 'version', children: [] };
        versionGroups.set(version, wrapper);
        nodes.push(wrapper);
      }
      wrapper.children.push(...parsed);
    }
    if (versionGroups.size > 0) {
      warnings.push(
        `Versioned navigation (${[...versionGroups.keys()].join(', ')}) was imported as top-level groups — not as separate docs versions.`,
      );
    }
    return { nodes, warnings };
  }
  if (isDict(navigation)) {
    return { nodes: resolveDivisions(navigation, warnings), warnings };
  }
  warnings.push('The Mintlify config has no navigation section — no pages were imported from it.');
  return { nodes: [], warnings };
};

// ─── Config-file discovery ───────────────────────────────────────────────────

/** Pick the config file from a repo listing: prefer docs.json, shallowest path wins. */
export const findMintlifyConfigPath = (blobPaths: string[]): string | null => {
  const byDepth = (a: string, b: string) => a.split('/').length - b.split('/').length;
  const docs = blobPaths.filter((p) => p === 'docs.json' || p.endsWith('/docs.json')).sort(byDepth);
  if (docs[0]) {
    return docs[0];
  }
  const mint = blobPaths.filter((p) => p === 'mint.json' || p.endsWith('/mint.json')).sort(byDepth);
  return mint[0] ?? null;
};

// ─── Site-chrome mapping (docs.json / mint.json → ProjectConfig) ─────────────

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const MAX_URL = 500;

const label = (value: string): string => value.slice(0, 80);
const safeUrl = (value: string | undefined, warnings: string[], what: string): string | undefined => {
  if (!value) {
    return undefined;
  }
  if (value.length > MAX_URL) {
    warnings.push(`Skipped ${what} — URL longer than ${MAX_URL} characters.`);
    return undefined;
  }
  return value;
};

const pageSlug = (path: string): string => slugify(path.split('/').filter(Boolean).pop() ?? '') || 'page';

/** Site path of the first leaf page under `nodes`, mirroring how the importer slugs the tree. */
const firstLeafPath = (nodes: NavNode[], prefix: string[]): string | null => {
  for (const node of nodes) {
    if (node.kind === 'page') {
      return [...prefix, pageSlug(node.path)].join('/');
    }
    const found = firstLeafPath(node.children, [...prefix, slugify(node.title) || 'group']);
    if (found) {
      return found;
    }
  }
  return null;
};

type NavLink = { label: string; href: string; external?: boolean };
type NavAnchor = NavLink & { icon?: string };

const toNavLink = (entry: unknown, warnings: string[]): NavLink | null => {
  if (!isDict(entry)) {
    return null;
  }
  const name = asString(entry.label) ?? asString(entry.name);
  const href = safeUrl(asString(entry.href) ?? asString(entry.url), warnings, `navbar link "${name ?? '?'}"`);
  if (!name || !href) {
    return null;
  }
  return { label: label(name), href, ...(isExternalUrl(href) ? { external: true } : {}) };
};

const toNavAnchor = (entry: unknown, warnings: string[]): NavAnchor | null => {
  const link = toNavLink(entry, warnings);
  if (!link) {
    return null;
  }
  const icon = isDict(entry) ? asString(entry.icon) : undefined;
  return { ...link, ...(icon ? { icon: icon.slice(0, 40) } : {}) };
};

export interface MintlifyConfigMapping {
  config: ProjectConfig;
  warnings: string[];
}

/**
 * Map the Mintlify site chrome onto our ProjectConfig:
 * colors.primary → styling.primaryColor; logo/favicon → branding;
 * navbar/topbarLinks/topbarCtaButton → navbar links + CTA; tabs → navbar.tabs;
 * anchors → navbar.anchors; footer/footerSocials → footer; name → seo.metaTitle.
 */
export const mapMintlifyConfig = (config: Dict, nav: NavNode[]): MintlifyConfigMapping => {
  const warnings: string[] = [];
  const patch: ProjectConfig = {};

  // colors.primary → styling.primaryColor
  const primary = isDict(config.colors) ? asString(config.colors.primary) : undefined;
  if (primary) {
    if (HEX_COLOR.test(primary)) {
      patch.styling = { primaryColor: primary };
    } else {
      warnings.push(`Skipped colors.primary "${primary}" — not a 3/6-digit hex color.`);
    }
  }

  // logo / favicon → branding. Only absolute http(s) URLs flow through: a
  // repo-relative path (e.g. `/logo/light.svg`) points at a file inside the
  // SOURCE repository — it does not exist on the published site, so writing it
  // would render broken images. Those are skipped with one warning.
  let skippedRepoRelativeBranding = false;
  const brandingUrl = (value: string | undefined, what: string): string | undefined => {
    if (!value) {
      return undefined;
    }
    if (!isExternalUrl(value)) {
      skippedRepoRelativeBranding = true;
      return undefined;
    }
    return safeUrl(value, warnings, what);
  };
  const branding: NonNullable<ProjectConfig['branding']> = {};
  const logo = config.logo;
  if (typeof logo === 'string') {
    const href = brandingUrl(asString(logo), 'logo');
    if (href) {
      branding.logoLight = href;
      branding.logoDark = href;
    }
  } else if (isDict(logo)) {
    const light = brandingUrl(asString(logo.light), 'light logo');
    const dark = brandingUrl(asString(logo.dark), 'dark logo');
    if (light) {
      branding.logoLight = light;
    }
    if (dark) {
      branding.logoDark = dark;
    }
  }
  const favicon = typeof config.favicon === 'string' ? config.favicon : isDict(config.favicon) ? asString(config.favicon.light) : undefined;
  const faviconUrl = brandingUrl(asString(favicon), 'favicon');
  if (faviconUrl) {
    branding.favicon = faviconUrl;
  }
  if (skippedRepoRelativeBranding) {
    warnings.push('Skipped repo-relative logo/favicon paths — upload your branding under Settings → Branding instead.');
  }
  if (Object.keys(branding).length > 0) {
    patch.branding = branding;
  }

  // navbar links + CTA (docs.json `navbar`, mint.json `topbarLinks`/`topbarCtaButton`)
  const navbar: NonNullable<ProjectConfig['navbar']> = {};
  const navbarSection = isDict(config.navbar) ? config.navbar : undefined;
  const rawLinks = navbarSection?.links ?? config.topbarLinks;
  if (Array.isArray(rawLinks)) {
    const links = rawLinks.map((entry) => toNavLink(entry, warnings)).filter((link): link is NavLink => link !== null);
    if (links.length > 0) {
      navbar.links = links.slice(0, 20);
    }
  }
  const cta = navbarSection?.primary ?? config.topbarCtaButton;
  if (isDict(cta)) {
    const href = safeUrl(asString(cta.href) ?? asString(cta.url), warnings, 'navbar CTA');
    const name = asString(cta.label) ?? asString(cta.name) ?? (asString(cta.type) === 'github' ? 'GitHub' : undefined);
    if (href && name) {
      navbar.ctaLabel = label(name);
      navbar.ctaUrl = href;
    }
  }

  // tabs → navbar.tabs: mint.json tabs carry urls; docs.json tabs became groups,
  // so their hrefs point at the first imported page of each tab.
  const tabs: NavLink[] = [];
  if (Array.isArray(config.tabs)) {
    for (const entry of config.tabs) {
      if (!isDict(entry)) {
        continue;
      }
      const name = asString(entry.name) ?? asString(entry.tab);
      const url = asString(entry.url) ?? asString(entry.href);
      if (!name || !url) {
        continue;
      }
      const href = safeUrl(isExternalUrl(url) ? url : `/${url.replace(/^\/+/, '')}`, warnings, `tab "${name}"`);
      if (href) {
        tabs.push({ label: label(name), href, ...(isExternalUrl(href) ? { external: true } : {}) });
      }
    }
  }
  for (const node of nav) {
    if (node.kind === 'group' && node.origin === 'tab') {
      const leaf = firstLeafPath(node.children, [slugify(node.title) || 'group']);
      if (leaf) {
        tabs.push({ label: label(node.title), href: `/${leaf}` });
      }
    }
  }
  if (tabs.length > 0) {
    navbar.tabs = tabs.slice(0, 10);
  }

  // anchors → navbar.anchors (mint.json `anchors`, docs.json `navigation.global.anchors`)
  const navigation = isDict(config.navigation) ? config.navigation : undefined;
  const globalAnchors = navigation && isDict(navigation.global) ? navigation.global.anchors : undefined;
  const rawAnchors = Array.isArray(config.anchors) ? config.anchors : Array.isArray(globalAnchors) ? globalAnchors : undefined;
  if (rawAnchors) {
    const anchors = rawAnchors
      .map((entry) => (isDict(entry) ? toNavAnchor({ ...entry, name: entry.name ?? entry.anchor }, warnings) : null))
      .filter((anchor): anchor is NavAnchor => anchor !== null);
    if (anchors.length > 0) {
      navbar.anchors = anchors.slice(0, 12);
    }
  }
  if (Object.keys(navbar).length > 0) {
    patch.navbar = navbar;
  }

  // footer / footerSocials → footer (github / x|twitter / linkedin)
  const socials =
    isDict(config.footer) && isDict(config.footer.socials) ? config.footer.socials : isDict(config.footerSocials) ? config.footerSocials : undefined;
  if (socials) {
    const footer: NonNullable<ProjectConfig['footer']> = {};
    const github = safeUrl(asString(socials.github), warnings, 'footer GitHub link');
    const x = safeUrl(asString(socials.x) ?? asString(socials.twitter), warnings, 'footer X link');
    const linkedin = safeUrl(asString(socials.linkedin), warnings, 'footer LinkedIn link');
    if (github) {
      footer.github = github;
    }
    if (x) {
      footer.x = x;
    }
    if (linkedin) {
      footer.linkedin = linkedin;
    }
    if (Object.keys(footer).length > 0) {
      patch.footer = footer;
    }
  }

  // name → seo.metaTitle (the closest thing we have to a site display name)
  const name = asString(config.name);
  if (name) {
    patch.seo = { metaTitle: name.slice(0, 160) };
  }

  const checked = projectConfigSchema.safeParse(patch);
  if (!checked.success) {
    warnings.push('Some site settings in the Mintlify config could not be mapped and were skipped.');
    return { config: {}, warnings };
  }
  return { config: checked.data, warnings };
};

// ─── Non-destructive config merge ────────────────────────────────────────────

const isEmptyValue = (value: unknown): boolean =>
  value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);

export interface ConfigMergeResult {
  merged: ProjectConfig;
  /** Dot-paths that were filled in (previously empty). */
  set: string[];
  /** Dot-paths skipped because the project already configured them. */
  kept: string[];
}

/**
 * Merge an imported config patch over the project's config WITHOUT clobbering:
 * a key is only written when the current value is empty (undefined/null/''/[]).
 */
export const mergeConfigPreservingExisting = (existing: ProjectConfig | null | undefined, incoming: ProjectConfig): ConfigMergeResult => {
  const merged: Record<string, unknown> = { ...(existing ?? {}) };
  const set: string[] = [];
  const kept: string[] = [];
  for (const [section, values] of Object.entries(incoming)) {
    if (!isDict(values)) {
      continue;
    }
    const current = isDict(merged[section]) ? { ...(merged[section] as Dict) } : {};
    for (const [key, value] of Object.entries(values)) {
      if (isEmptyValue(value)) {
        continue;
      }
      if (isEmptyValue(current[key])) {
        current[key] = value;
        set.push(`${section}.${key}`);
      } else {
        kept.push(`${section}.${key}`);
      }
    }
    if (Object.keys(current).length > 0) {
      merged[section] = current;
    }
  }
  return { merged: merged as ProjectConfig, set, kept };
};
