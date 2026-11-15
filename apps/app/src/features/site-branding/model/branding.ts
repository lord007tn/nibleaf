/**
 * Site configuration → Branding, as pure logic: what the form edits, what a
 * save sends, and whether an upload's result may still fill its field.
 * Rendered by `components/branding-settings.tsx`; tested in `branding.test.ts`.
 */

/** The fields an upload can fill; the logo destination is typed only. */
const UPLOAD_FIELDS = ['logoLight', 'logoDark', 'favicon'] as const;
export type UploadField = (typeof UPLOAD_FIELDS)[number];

/** Everything the Branding form edits, in one place, so "dirty" has one meaning. */
export type BrandingValues = Record<UploadField | 'logoHref', string>;
type BrandingKey = keyof BrandingValues;

const KEYS: readonly BrandingKey[] = [...UPLOAD_FIELDS, 'logoHref'];

/** `config.branding` as the API stores it: each field a path or URL, or null once cleared. */
type BrandingConfigLike = Partial<Record<BrandingKey, string | null>>;

/** The form's values for a site's config: a cleared or never-set field is blank. */
export function brandingValues(config: { branding?: BrandingConfigLike | null } | null | undefined): BrandingValues {
  const branding = config?.branding ?? {};
  return normalizeBranding({
    logoLight: branding.logoLight ?? '',
    logoDark: branding.logoDark ?? '',
    favicon: branding.favicon ?? '',
    logoHref: branding.logoHref ?? '',
  });
}

/** What a save stores: every path and URL trimmed. */
export function normalizeBranding(values: BrandingValues): BrandingValues {
  return {
    logoLight: values.logoLight.trim(),
    logoDark: values.logoDark.trim(),
    favicon: values.favicon.trim(),
    logoHref: values.logoHref.trim(),
  };
}

/** The `config.branding` patch a save sends. */
export type BrandingUpdate = Partial<Record<BrandingKey, string | null>>;

/**
 * The branding patch for the change from `baseline` to `submitted`.
 *
 * The API merges `config.branding` one level deep, so a field left out keeps
 * its stored value and every other config section is untouched. Only fields
 * that changed are sent, so a save never writes back a stale copy of a field
 * someone else changed. A field emptied by the person is sent as `null`, as
 * this form always has: the schema allows it, and it stores "not set" rather
 * than an empty path.
 */
export function brandingUpdate(baseline: BrandingValues, submitted: BrandingValues): BrandingUpdate {
  const before = normalizeBranding(baseline);
  const after = normalizeBranding(submitted);
  const update: BrandingUpdate = {};
  for (const key of KEYS) {
    if (before[key] !== after[key]) update[key] = after[key] || null;
  }
  return update;
}

/**
 * One upload, as the form remembers it: which draft it belongs to (`draft`,
 * bumped when the person discards or the form moves to another site) and the
 * value its field held when the file was chosen.
 */
export type UploadRequest = { field: UploadField; draft: number; startedFrom: string };

/**
 * What a finished upload may do with its URL:
 * - `apply`: fill the field (the draft becomes dirty; nothing is saved);
 * - `stale`: the draft it belongs to is gone (discarded, or another site): do nothing, say nothing;
 * - `superseded`: the field has changed since the file was chosen (typed, cleared
 *   or updated from the server): the newer value wins.
 *
 * The asset itself stays in the site's files either way.
 */
export function uploadResultAction(request: UploadRequest, now: { draft: number; value: string }): 'apply' | 'stale' | 'superseded' {
  if (request.draft !== now.draft) return 'stale';
  return now.value === request.startedFrom ? 'apply' : 'superseded';
}
