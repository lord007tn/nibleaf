/**
 * Site settings → OpenAPI, as pure logic: what the form edits, what a save
 * sends, and what the server confirms. Rendered by
 * `components/openapi-settings.tsx`; tested in `openapi.test.ts`.
 */

/** A saved source, as the server reports it. An uploaded document is stored but never sent back. */
export type OpenApiSavedSource = { type: 'upload' } | { type: 'url'; url: string } | { type: 'repository'; path: string };

/** The parts of the site's configuration the form reads. */
type OpenApiConfigurationLike = { title: string; path: string; source: OpenApiSavedSource };

export type OpenApiSourceType = OpenApiSavedSource['type'];

/**
 * The source being edited: its kind and its text (the pasted or uploaded
 * document, the URL, or the repository path) as one value, so a server change
 * replaces or keeps them together and the text never lands under another kind.
 */
export type OpenApiSourceDraft = { type: OpenApiSourceType; value: string };

/** Everything the OpenAPI form edits, in one place, so "dirty" has one meaning. */
export type OpenApiValues = { title: string; path: string; source: OpenApiSourceDraft };

/** Where a new reference is published unless the person picks another path. */
export const DEFAULT_OPENAPI_PATH = 'api-reference';

/** The text a source is edited as: its URL or repository path. An uploaded document edits as empty. */
export function sourceValueOf(source: OpenApiSavedSource): string {
  if (source.type === 'url') return source.url;
  if (source.type === 'repository') return source.path;
  return '';
}

/**
 * The form's values for the site's configuration. With none yet, a new
 * reference: `defaultTitle`, the default path, and an upload.
 */
export function openApiValues(current: OpenApiConfigurationLike | null | undefined, defaultTitle: string): OpenApiValues {
  if (!current) return { title: defaultTitle, path: DEFAULT_OPENAPI_PATH, source: { type: 'upload', value: '' } };
  return { title: current.title, path: current.path, source: { type: current.source.type, value: sourceValueOf(current.source) } };
}

/** The source a switch to `next` starts at: the saved one if it is that kind, else empty. */
export const switchSource = (current: OpenApiConfigurationLike | null | undefined, next: OpenApiSourceType): OpenApiSourceDraft => ({
  type: next,
  value: current?.source.type === next ? sourceValueOf(current.source) : '',
});

export type OpenApiSource = { type: 'upload'; content: string } | { type: 'url'; url: string } | { type: 'repository'; path: string };

/** What a save sends. An empty source field sends no source, so the server keeps the saved one. */
export function openApiUpsertBody(values: OpenApiValues): { title: string; path: string; source?: OpenApiSource } {
  const value = values.source.value.trim();
  let source: OpenApiSource | undefined;
  if (value) {
    if (values.source.type === 'upload') source = { type: 'upload', content: values.source.value };
    else if (values.source.type === 'url') source = { type: 'url', url: value };
    else source = { type: 'repository', path: value };
  }
  return { title: values.title.trim(), path: values.path.trim(), source };
}

/**
 * Whether Save can be pressed: a name and a path, and a source when there is
 * none yet or the person switched to another kind of source.
 */
export function canSaveOpenApi(values: OpenApiValues, current: OpenApiConfigurationLike | null | undefined): boolean {
  if (!values.title.trim() || !values.path.trim()) return false;
  const hasSource = Boolean(values.source.value.trim());
  if (!current) return hasSource;
  return values.source.type === current.source.type || hasSource;
}

/**
 * What the server holds after saving `submitted` over `baseline`, in form
 * values: the trimmed text; an uploaded document is stored, not echoed back,
 * so its field empties; a save that sent no source kept the saved one.
 */
export function confirmedOpenApiValues(baseline: OpenApiValues, submitted: OpenApiValues): OpenApiValues {
  const { title, path, source } = openApiUpsertBody(submitted);
  if (!source) return { title, path, source: baseline.source };
  return { title, path, source: { type: source.type, value: source.type === 'upload' ? '' : sourceValueOf(source) } };
}
