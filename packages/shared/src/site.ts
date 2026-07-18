import GithubSlugger from 'github-slugger';
import { excerpt } from './utils';

/** Per-page SEO + behaviour overrides baked into the snapshot. Mirrors
 *  `pageConfigSchema` in @nibleaf/validators (kept inline to avoid a dep). */
export interface SnapshotPageConfig {
  seo?: { metaTitle?: string; metaDescription?: string; ogImage?: string; canonicalUrl?: string; noindex?: boolean };
  sidebarTitle?: string;
  tag?: string;
  tags?: string[];
  category?: string;
  categoryIcon?: string;
  categoryOrder?: number;
  mode?: 'default' | 'wide' | 'center';
  hideToc?: boolean;
}

interface SnapshotNavLink {
  label: string;
  href: string;
  external?: boolean;
}
interface SnapshotNavAnchor extends SnapshotNavLink {
  icon?: string;
}

/** Per-language overrides baked into the snapshot. Mirrors
 *  `languageConfigSchema` in @nibleaf/validators (kept inline to avoid a dep).
 *  The chrome sections override the matching `project.config` sections for
 *  visitors browsing this language (see `mergeLanguageChrome`). */
export interface SnapshotLanguageConfig {
  /** Localized site name (header brand, og:site_name, title suffix). */
  name?: string;
  /** Localized site description (SEO description fallback). */
  description?: string;
  seo?: { metaTitle?: string; metaDescription?: string; socialImage?: string; allowIndex?: boolean };
  navbar?: { ctaLabel?: string; links?: SnapshotNavLink[]; tabs?: SnapshotNavLink[]; anchors?: SnapshotNavAnchor[] } | null;
  footer?: { copyright?: string } | null;
  banner?: { enabled?: boolean; message?: string; linkLabel?: string; linkUrl?: string; dismissible?: boolean } | null;
  search?: { placeholder?: string } | null;
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
  /** Serving toggle — a disabled language is hidden from every public surface.
   *  Optional so snapshots published before the toggle existed read as enabled. */
  enabled?: boolean;
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

/** The languages a published site serves: enabled ones. The default language
 *  always serves (it is every visitor's fallback), even if a stale flag says
 *  otherwise. Disabled languages stay editable in the dashboard but disappear
 *  from every public surface. */
export const publicLanguages = (languages: SnapshotLanguage[]): SnapshotLanguage[] =>
  languages.filter((language) => language.isDefault || language.enabled !== false);

/** Chrome sections a language may override on top of the project config. */
const LANGUAGE_CHROME_SECTIONS = ['navbar', 'footer', 'banner', 'search'] as const;

const isPlainObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/**
 * Overlay the active language's chrome overrides (navbar/footer/banner/search)
 * onto the project config, mirroring the project-config merge semantics:
 * object sections merge one level deep (a defined language value wins per key)
 * and arrays replace wholesale when the language defines them. Empty strings
 * and empty arrays are treated as "no override". Returns the input config
 * unchanged (same reference) when the language overrides nothing, and never
 * mutates its inputs — safe on cached snapshots.
 */
export const mergeLanguageChrome = (
  config: Record<string, unknown> | null,
  languageConfig: SnapshotLanguageConfig | null | undefined,
): Record<string, unknown> | null => {
  if (!languageConfig) {
    return config;
  }
  let merged: Record<string, unknown> | null = null;
  for (const section of LANGUAGE_CHROME_SECTIONS) {
    const override = (languageConfig as Record<string, unknown>)[section];
    if (!isPlainObject(override)) {
      continue;
    }
    const entries = Object.entries(override).filter(
      ([, value]) => value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && value.length === 0),
    );
    if (entries.length === 0) {
      continue;
    }
    merged = merged ?? { ...(config ?? {}) };
    const base = merged[section];
    merged[section] = { ...(isPlainObject(base) ? base : {}), ...Object.fromEntries(entries) };
  }
  return merged ?? config;
};

/** A copy of the snapshot narrowed to what the public site serves: disabled
 *  languages and their pages are dropped (feeds sitemap/llms/robots surfaces).
 *  Returns the input snapshot unchanged when every language serves. */
export const publicSiteSnapshot = (snapshot: SiteSnapshot): SiteSnapshot => {
  const served = publicLanguages(snapshot.project.languages);
  if (served.length === snapshot.project.languages.length) {
    return snapshot;
  }
  const servedCodes = new Set(served.map((language) => language.code));
  return {
    ...snapshot,
    project: { ...snapshot.project, languages: served },
    pages: snapshot.pages.filter((page) => servedCodes.has(page.languageCode)),
  };
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

export interface ResolvedPageCategory {
  title: string;
  icon: string | null;
  order: number;
}

const LARGE_FLAT_COLLECTION = 24;

/** Resolve an explicit category, or infer a conservative workflow category for
 *  very large flat help-center imports. Explicit author metadata always wins;
 *  small hand-authored trees are never classified automatically. */
export const resolvePageCategory = (page: SnapshotPage, siblingPageCount: number): ResolvedPageCategory | null => {
  const explicit = page.config?.category?.trim();
  if (explicit) {
    return {
      title: explicit,
      icon: page.config?.categoryIcon?.trim() || null,
      order: page.config?.categoryOrder ?? 999,
    };
  }
  if (page.kind !== 'PAGE' || siblingPageCount < LARGE_FLAT_COLLECTION) {
    return null;
  }

  const haystack = `${page.title} ${page.slug}`.toLocaleLowerCase(page.languageCode);
  const ar = page.languageCode.toLowerCase().startsWith('ar');
  const rules: Array<{ title: string; icon: string; order: number; keywords: string[] }> = ar
    ? [
        { title: 'ابدأ هنا', icon: 'rocket', order: 0, keywords: ['ابدأ', 'مقدمة', 'الخطوات الأولى', 'إعداد', 'تجربة المنصة', 'لوحة التحكم'] },
        {
          title: 'التقارير والعمليات',
          icon: 'chart-no-axes-column',
          order: 6,
          keywords: ['تقرير', 'تقارير', 'إحصائ', 'عمليات', 'تتبع', 'مراجعة الحجوزات'],
        },
        {
          title: 'المحاسبة والفوترة',
          icon: 'receipt-text',
          order: 5,
          keywords: ['محاسب', 'فاتور', 'دفع', 'دفعات', 'سداد', 'مالي', 'بنك', 'زكاة', 'ضريب', 'zatca', 'رصيد'],
        },
        { title: 'الفنادق والغرف', icon: 'hotel', order: 1, keywords: ['فندق', 'فنادق', 'غرفة', 'غرف', 'تسكين', 'الوصول', 'المغادرة', 'إتاحة'] },
        {
          title: 'العقود والأسعار',
          icon: 'badge-dollar-sign',
          order: 3,
          keywords: ['عقد', 'عقود', 'سعر', 'أسعار', 'عرض', 'عروض', 'برومو', 'خدمة', 'خصم'],
        },
        { title: 'الحجوزات', icon: 'calendar-check', order: 2, keywords: ['حجز', 'حجوزات', 'ضيف', 'نقل', 'مواصلات'] },
        { title: 'العملاء والوكالات', icon: 'users-round', order: 4, keywords: ['عميل', 'عملاء', 'وكالة', 'وكالات', 'وكيل', 'مورد', 'شركة'] },
        {
          title: 'المستخدمون والصلاحيات',
          icon: 'shield-check',
          order: 7,
          keywords: ['مستخدم', 'مستخدمين', 'صلاحية', 'صلاحيات', 'دور', 'أدوار', 'مجموعة'],
        },
        { title: 'التواصل', icon: 'messages-square', order: 8, keywords: ['رسالة', 'رسائل', 'بريد', 'واتساب', 'إشعار', 'موقع إلكتروني'] },
        { title: 'التكاملات', icon: 'blocks', order: 9, keywords: ['تكامل', 'ربط', 'channel manager', 'pms', 'stc', 'hyperpay'] },
      ]
    : [
        {
          title: 'Getting started',
          icon: 'rocket',
          order: 0,
          keywords: ['getting started', 'get started', 'first step', 'introduction', 'setup your', 'setup-your', 'dashboard', 'trial platform'],
        },
        {
          title: 'Reports & operations',
          icon: 'chart-no-axes-column',
          order: 6,
          keywords: ['report', 'statistics', 'operation', 'tracking', 'audit'],
        },
        {
          title: 'Accounting & invoicing',
          icon: 'receipt-text',
          order: 5,
          keywords: ['account', 'invoice', 'payment', 'receipt', 'financial', 'bank', 'tax', 'zatca', 'balance'],
        },
        {
          title: 'Hotels & rooms',
          icon: 'hotel',
          order: 1,
          keywords: ['hotel', 'room', 'check-in', 'check in', 'check-out', 'check out', 'arrival', 'departure', 'accommodation', 'availability'],
        },
        {
          title: 'Contracts & pricing',
          icon: 'badge-dollar-sign',
          order: 3,
          keywords: ['contract', 'price', 'pricing', 'promo', 'offer', 'service', 'discount'],
        },
        { title: 'Reservations', icon: 'calendar-check', order: 2, keywords: ['reservation', 'booking', 'guest', 'transportation'] },
        { title: 'Customers & agencies', icon: 'users-round', order: 4, keywords: ['client', 'customer', 'agency', 'agent', 'provider', 'company'] },
        { title: 'Users & access', icon: 'shield-check', order: 7, keywords: ['user', 'role', 'permission', 'access', 'group'] },
        { title: 'Communications', icon: 'messages-square', order: 8, keywords: ['sms', 'e-mail', 'email', 'whatsapp', 'notification', 'website'] },
        { title: 'Integrations', icon: 'blocks', order: 9, keywords: ['integration', 'channel manager', 'pms', 'stc', 'hyperpay'] },
      ];
  const match = rules.find((rule) => rule.keywords.some((keyword) => haystack.includes(keyword)));
  return match
    ? { title: match.title, icon: match.icon, order: match.order }
    : { title: ar ? 'أدلة إضافية' : 'More guides', icon: 'book-open', order: 10 };
};

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
  const build = (parentId: string | null): NavNode[] => {
    const siblings = (byParent.get(parentId) ?? []).sort((a, b) => a.position - b.position);
    const siblingPageCount = siblings.filter((page) => page.kind === 'PAGE').length;
    const toNode = (page: SnapshotPage): NavNode => ({
      id: page.id,
      kind: page.kind,
      // Mintlify-style: a short sidebar label overrides the full page title in nav.
      title: page.config?.sidebarTitle?.trim() || page.title,
      path: page.path,
      icon: page.icon,
      tag: page.config?.tag?.trim() || null,
      children: build(page.id),
    });

    // Categories are deliberately virtual: imported flat collections can gain
    // an ergonomic, collapsible sidebar without re-parenting pages or breaking
    // any existing URL. Real groups remain first; uncategorized pages follow the
    // explicitly ordered category sections.
    const plain: NavNode[] = [];
    const categories = new Map<string, { title: string; icon: string | null; order: number; firstPosition: number; pages: SnapshotPage[] }>();
    for (const page of siblings) {
      const resolvedCategory = resolvePageCategory(page, siblingPageCount);
      if (!resolvedCategory) {
        plain.push(toNode(page));
        continue;
      }
      const { title } = resolvedCategory;
      const existing = categories.get(title);
      if (existing) {
        existing.pages.push(page);
        existing.order = Math.min(existing.order, resolvedCategory.order);
      } else {
        categories.set(title, {
          title,
          icon: resolvedCategory.icon,
          order: resolvedCategory.order,
          firstPosition: page.position,
          pages: [page],
        });
      }
    }
    const grouped = [...categories.values()]
      .sort((a, b) => a.order - b.order || a.firstPosition - b.firstPosition || a.title.localeCompare(b.title))
      .map<NavNode>((category) => ({
        id: `category:${parentId ?? 'root'}:${category.title}`,
        kind: 'GROUP',
        title: category.title,
        path: category.pages[0]?.path ?? '',
        icon: category.icon,
        tag: null,
        children: category.pages.sort((a, b) => a.position - b.position).map(toNode),
      }));
    const realGroups = plain.filter((node) => node.kind === 'GROUP');
    const uncategorizedPages = plain.filter((node) => node.kind === 'PAGE');
    return [...realGroups, ...grouped, ...uncategorizedPages];
  };
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

type LanguageRow = {
  code: string;
  label: string;
  direction: 'LTR' | 'RTL';
  isDefault: boolean;
  enabled?: boolean;
  config: unknown;
  projectTranslations?: { name: string | null; description: string | null }[];
};
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
  const languages: SnapshotLanguage[] = project.languages.map((l) => {
    const translation = l.projectTranslations?.[0];
    const base = (l.config as SnapshotLanguageConfig | null) ?? {};
    const config = {
      ...base,
      ...(translation?.name ? { name: translation.name } : {}),
      ...(translation?.description ? { description: translation.description } : {}),
    };
    return {
      code: l.code,
      label: l.label,
      direction: l.direction,
      isDefault: l.isDefault,
      enabled: l.enabled ?? true,
      config: Object.keys(config).length > 0 ? config : null,
    };
  });
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
