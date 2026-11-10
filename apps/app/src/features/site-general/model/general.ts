/**
 * Site settings → General, as pure logic: what the form edits, how it is
 * validated, and which requests a save sends. Rendered by
 * `components/general-settings.tsx`; tested in `general.test.ts`.
 */

/** A small curated set of emoji the site can use as its icon. */
export const GENERAL_ICON_CHOICES = ['📘', '📕', '📗', '🚀', '⚡', '🛠️', '🧩', '🔌', '📦', '🌐', '🔭', '✨'] as const;

export type TranslationValues = { name: string; description: string };

/** Everything the General form edits, in one place, so "dirty" has one meaning. */
export type GeneralValues = {
  name: string;
  slug: string;
  description: string;
  icon: string | null;
  /** Site name and description per non-default language, by language id. */
  translations: Record<string, TranslationValues>;
};

type ProjectLike = { name: string; slug: string; description?: string | null; icon?: string | null };
type LanguageLike = {
  id: string;
  isDefault: boolean;
  position: number;
  translation?: { name?: string | null; description?: string | null } | null;
};

/** The default language first, then by position: the order every language list uses. */
export function orderLanguages<T extends { isDefault: boolean; position: number }>(languages: readonly T[]): T[] {
  return [...languages].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.position - b.position);
}

/** The form's values for a site, normalized the way the server stores them. */
export function generalValues(project: ProjectLike, languages: readonly LanguageLike[] = []): GeneralValues {
  const translations: Record<string, TranslationValues> = {};
  for (const language of orderLanguages(languages)) {
    if (language.isDefault) continue;
    translations[language.id] = { name: language.translation?.name ?? '', description: language.translation?.description ?? '' };
  }
  return {
    name: project.name,
    slug: project.slug,
    description: project.description ?? '',
    icon: project.icon ?? null,
    translations,
  };
}

/** What a save sends: text trimmed, as the server would store it. */
export function normalizeGeneral(values: GeneralValues): GeneralValues {
  const translations: Record<string, TranslationValues> = {};
  for (const [id, value] of Object.entries(values.translations)) {
    translations[id] = { name: value.name.trim(), description: value.description.trim() };
  }
  return { name: values.name.trim(), slug: values.slug.trim(), description: values.description.trim(), icon: values.icon, translations };
}

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export type NameProblem = 'required';
export type SlugProblem = 'required' | 'format';

export const nameProblem = (value: string): NameProblem | undefined => (value.trim() ? undefined : 'required');

export function slugProblem(value: string): SlugProblem | undefined {
  if (!value.trim()) return 'required';
  return SLUG_PATTERN.test(value.trim()) ? undefined : 'format';
}

export type ProjectUpdate = { name: string; slug: string; description: string | null; icon: string | null };
export type TranslationUpdate = { id: string; translation: TranslationValues | null };

/**
 * The requests a save sends for the change from `baseline` to `submitted`:
 * one project update when any site field changed, and one language update per
 * translation that changed. An emptied translation clears its override.
 */
export function generalSaveRequests(
  baseline: GeneralValues,
  submitted: GeneralValues,
): { project: ProjectUpdate | null; translations: TranslationUpdate[] } {
  const before = normalizeGeneral(baseline);
  const after = normalizeGeneral(submitted);
  const projectChanged =
    before.name !== after.name || before.slug !== after.slug || before.description !== after.description || before.icon !== after.icon;
  const translations: TranslationUpdate[] = [];
  for (const [id, value] of Object.entries(after.translations)) {
    const previous = before.translations[id] ?? { name: '', description: '' };
    if (previous.name === value.name && previous.description === value.description) continue;
    translations.push({ id, translation: value.name || value.description ? value : null });
  }
  return {
    project: projectChanged ? { name: after.name, slug: after.slug, description: after.description || null, icon: after.icon } : null,
    translations,
  };
}

/**
 * How to pick which language's translation to edit: one extra language needs
 * no control (a one-option switch reads as a mystery button), a few get a
 * segmented control, many get a select.
 */
export function translationChooser(extraLanguageCount: number): 'none' | 'single' | 'segmented' | 'select' {
  if (extraLanguageCount === 0) return 'none';
  if (extraLanguageCount === 1) return 'single';
  return extraLanguageCount <= 3 ? 'segmented' : 'select';
}

/**
 * The address the site is served at, for the preview under the field. Only a
 * configured base domain gets a `slug.<base>` host; otherwise the free
 * subdomain would 404, so the working `/sites/:id` path is shown.
 */
export function siteAddressPreview(slug: string, baseDomain: string | undefined, projectId: string): string {
  if (!baseDomain) return `/sites/${projectId}`;
  return slug ? `${slug}.${baseDomain}` : `.${baseDomain}`;
}

/** The base domain from `VITE_SITE_BASE_DOMAIN`, without a leading wildcard or trailing dot. */
export const normalizeBaseDomain = (value: string | undefined) => value?.replace(/^\*\./, '').replace(/\.$/, '') || undefined;

/** Whether a failed save was the server refusing the address because another site has it. */
export function isSlugTaken(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { status, details } = error as { status?: unknown; details?: unknown };
  return status === 409 && typeof details === 'object' && details !== null && 'slug' in details;
}
