/**
 * Site configuration → SEO, as pure logic. One form edits the four values of
 * the active scope: "default" edits the project's `config.seo`; a language
 * scope edits that language's `config.seo`, layered between the project's SEO
 * and each page's own. Rendered by `components/seo-settings.tsx`.
 *
 * Indexing: the reader adds noindex when the site is private, the page says
 * noindex, the project says `allowIndex: false` or the language does. A
 * language's `true` never overrides the project's `false`; nothing here
 * changes that.
 */

/** `config.seo` as the API stores it, for the project and a language alike. */
export type SeoConfig = { metaTitle?: string; metaDescription?: string; socialImage?: string; allowIndex?: boolean };

/** The four editable values, the same in every scope. */
export type SeoValues = { metaTitle: string; metaDescription: string; socialImage: string; allowIndex: boolean };

type TextKey = 'metaTitle' | 'metaDescription' | 'socialImage';
const TEXT_KEYS: readonly TextKey[] = ['metaTitle', 'metaDescription', 'socialImage'];

/** The scope the picker selects: the project ("default") or a language id. */
export const PROJECT_SCOPE = 'default';

/** A scope's values: an unset text is blank, and an unset `allowIndex` allows indexing. */
export function seoValues(seo: SeoConfig | null | undefined): SeoValues {
  return {
    metaTitle: seo?.metaTitle ?? '',
    metaDescription: seo?.metaDescription ?? '',
    socialImage: seo?.socialImage ?? '',
    allowIndex: seo?.allowIndex ?? true,
  };
}

/**
 * What a save stores for a scope: every text trimmed, a cleared one as `''`
 * (never left out: the server merges `seo` key by key and would keep an
 * omitted key). The reader treats `''` as "inherit".
 */
function storedSeo(values: SeoValues): Required<SeoConfig> {
  return {
    metaTitle: values.metaTitle.trim(),
    metaDescription: values.metaDescription.trim(),
    socialImage: values.socialImage.trim(),
    allowIndex: values.allowIndex,
  };
}

/** The project scope's `config.seo` patch: all four values. */
export const projectSeoPatch = (values: SeoValues): Required<SeoConfig> => storedSeo(values);

/**
 * A language scope's `config` patch. With nothing to override (every text
 * blank and indexing allowed) it is `null`: the server then clears the
 * language's SEO and keeps its other sections (navbar, footer, banner,
 * search); the localized site name and description live elsewhere and are
 * untouched. Otherwise all four values, like the project scope.
 */
export function languageSeoConfig(values: SeoValues): { seo: Required<SeoConfig> } | null {
  const seo = storedSeo(values);
  const overrides = TEXT_KEYS.some((key) => seo[key] !== '') || !seo.allowIndex;
  return overrides ? { seo } : null;
}

/**
 * What an empty text field shows, so the form reads complete. The project
 * scope falls back to the site's name and description; a language scope shows
 * what it inherits: the project's SEO text, else the site's name and
 * description. The social image suggests a path.
 */
export function seoPlaceholders(
  scope: 'project' | 'language',
  projectSeo: SeoConfig | null | undefined,
  site: { name: string; description?: string | null },
): Record<TextKey, string | undefined> {
  const inherited = scope === 'language' ? projectSeo : undefined;
  return {
    metaTitle: inherited?.metaTitle || site.name,
    metaDescription: inherited?.metaDescription || site.description || undefined,
    socialImage: inherited?.socialImage || '/og/cover.png',
  };
}

/**
 * One social-image upload, as the form remembers it: the draft it belongs to
 * (`draft`, bumped on discard and whenever the form leaves its site or scope),
 * how many times the field had been edited (`edits`) and its value when the
 * file was chosen.
 */
export type UploadRequest = { draft: number; edits: number; startedFrom: string };

/**
 * What a finished upload may do with its URL:
 * - `apply`: fill the field (the draft becomes dirty; nothing is saved);
 * - `stale`: its draft is gone (discarded, another scope or site, even after
 *   coming back): do nothing, say nothing;
 * - `superseded`: the field was edited, cleared or changed by the server
 *   since: the newer value wins.
 *
 * The uploaded file stays in the site's files either way.
 */
export function uploadResultAction(request: UploadRequest, now: { draft: number; edits: number; value: string }): 'apply' | 'stale' | 'superseded' {
  if (request.draft !== now.draft) return 'stale';
  return now.edits === request.edits && now.value === request.startedFrom ? 'apply' : 'superseded';
}
