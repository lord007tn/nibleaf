/**
 * Site settings section ids and URL parsing (operations/ui-overhaul.md §5.7).
 *
 * This file is part of the router's eager chunk, which published docs pages
 * load, so it holds ids and plain checks only: no labels, icons or components.
 */

/** Every settings page, in nav order. */
export const SECTION_IDS = [
  'general',
  'appearance',
  'languages',
  'domain',
  'authentication',
  'addons',
  'integrations',
  'seo',
  'redirects',
  'variables',
  'search',
  'git',
  'openapi',
  'contentImport',
  'exports',
  'ai',
  'apiKeys',
  'members',
  'usage',
  'danger',
] as const;
export type SectionId = (typeof SECTION_IDS)[number];

/**
 * Plan and Notifications moved to the organization (§5.2). Old links still
 * open a one-line pointer to where they live now; they are not in the nav.
 */
export const MOVED_SECTION_IDS = ['plan', 'notifications'] as const;
export type MovedSectionId = (typeof MOVED_SECTION_IDS)[number];

/**
 * The parts of the one Appearance page (§5.7): Brand, Theme (accent colour,
 * corners and the theme), Typography, and the header, footer and banner.
 * SEO, Redirects, Variables and Search are pages of their own.
 */
export type AppearanceSectionId = 'brand' | 'theme' | 'typography' | 'chrome';

/**
 * What `appearanceSection` may name: a part, or one of Appearance's seven
 * former tabs, which the page maps to the part that holds it now (outside this
 * eager chunk: `site-appearance/model/parts`).
 */
const APPEARANCE_LINKS = ['brand', 'theme', 'typography', 'chrome', 'branding', 'themes', 'styling', 'navbar', 'footer', 'banner'] as const;
export type AppearanceLink = (typeof APPEARANCE_LINKS)[number];

/** Appearance subsections that became pages: old `?section=appearance&appearanceSection=…` links open the page. */
const PROMOTED_APPEARANCE_SECTIONS = { seo: 'seo', redirects: 'redirects', variables: 'variables', search: 'search' } as const satisfies Record<
  string,
  SectionId
>;

const includes = <T extends string>(list: readonly T[], value: unknown): value is T => (list as readonly unknown[]).includes(value);
export const isSectionId = (value: unknown): value is SectionId => includes(SECTION_IDS, value);
export const isMovedSectionId = (value: unknown): value is MovedSectionId => includes(MOVED_SECTION_IDS, value);
const isAppearanceLink = (value: unknown): value is AppearanceLink => includes(APPEARANCE_LINKS, value);

export type SettingsSearch = {
  section?: SectionId | MovedSectionId;
  appearanceSection?: AppearanceLink;
  /**
   * The integration open inside Integrations (`?integration=…`), kept as the link gave it: Integrations
   * itself knows which ones exist (features/site-integrations/model/hub.ts), so the list stays out of this
   * eager chunk, and an unknown one shows the hub.
   */
  integration?: string;
};

/**
 * The route's search params. An absent section stays absent (the default
 * entry picks one by role; on a phone it is the list of pages); anything
 * unknown is dropped.
 */
export function parseSettingsSearch(search: Record<string, unknown>): SettingsSearch {
  const { section, appearanceSection, integration } = search;
  // The old Analytics page is Integrations → Analytics now.
  if (section === 'analytics') return { section: 'integrations', integration: 'analytics' };
  if (section === 'appearance' && typeof appearanceSection === 'string' && Object.hasOwn(PROMOTED_APPEARANCE_SECTIONS, appearanceSection)) {
    return { section: PROMOTED_APPEARANCE_SECTIONS[appearanceSection as keyof typeof PROMOTED_APPEARANCE_SECTIONS] };
  }
  // Smart AI was renamed; Analytics folded into Integrations (above). This file is in the public reader's
  // eager chunk, so the one rename is a comparison, not a lookup table.
  const parsed: SettingsSearch['section'] = isSectionId(section) || isMovedSectionId(section) ? section : section === 'smartAi' ? 'ai' : undefined;
  return {
    section: parsed,
    ...(parsed === 'appearance' && isAppearanceLink(appearanceSection) ? { appearanceSection } : {}),
    ...(parsed === 'integrations' && typeof integration === 'string' ? { integration } : {}),
  };
}
