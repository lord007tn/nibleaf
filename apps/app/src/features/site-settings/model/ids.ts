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
  'seo',
  'redirects',
  'variables',
  'search',
  'git',
  'openapi',
  'contentImport',
  'exports',
  'smartAi',
  'apiKeys',
  'integrations',
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

/** Appearance's own sections. SEO, Redirects, Variables and Search are pages of their own now. */
export const APPEARANCE_SECTION_IDS = ['branding', 'themes', 'styling', 'typography', 'navbar', 'footer', 'banner'] as const;
export type AppearanceSectionId = (typeof APPEARANCE_SECTION_IDS)[number];

/** Appearance subsections that became pages: old `?section=appearance&appearanceSection=…` links open the page. */
const PROMOTED_APPEARANCE_SECTIONS = { seo: 'seo', redirects: 'redirects', variables: 'variables', search: 'search' } as const satisfies Record<
  string,
  SectionId
>;

/** Sections that were renamed or folded into another. */
const RENAMED_SECTIONS: Readonly<Record<string, SectionId>> = { analytics: 'integrations' };

const includes = <T extends string>(list: readonly T[], value: unknown): value is T => (list as readonly unknown[]).includes(value);
const isSectionId = (value: unknown): value is SectionId => includes(SECTION_IDS, value);
export const isMovedSectionId = (value: unknown): value is MovedSectionId => includes(MOVED_SECTION_IDS, value);
const isAppearanceSectionId = (value: unknown): value is AppearanceSectionId => includes(APPEARANCE_SECTION_IDS, value);

export type SettingsSearch = { section?: SectionId | MovedSectionId; appearanceSection?: AppearanceSectionId };

/**
 * The route's search params. An absent section stays absent (the default
 * entry picks one by role; on a phone it is the list of pages); anything
 * unknown is dropped.
 */
export function parseSettingsSearch(search: Record<string, unknown>): SettingsSearch {
  const { section, appearanceSection } = search;
  if (section === 'appearance' && typeof appearanceSection === 'string' && Object.hasOwn(PROMOTED_APPEARANCE_SECTIONS, appearanceSection)) {
    return { section: PROMOTED_APPEARANCE_SECTIONS[appearanceSection as keyof typeof PROMOTED_APPEARANCE_SECTIONS] };
  }
  const parsed: SettingsSearch['section'] =
    isSectionId(section) || isMovedSectionId(section) ? section : typeof section === 'string' ? RENAMED_SECTIONS[section] : undefined;
  return {
    section: parsed,
    ...(parsed === 'appearance' && isAppearanceSectionId(appearanceSection) ? { appearanceSection } : {}),
  };
}
