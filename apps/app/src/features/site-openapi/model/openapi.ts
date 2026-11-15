/**
 * Site settings → OpenAPI, as pure logic: what the form edits, what a save
 * sends, and what the server confirms. Rendered by
 * `components/openapi-settings.tsx`; tested in `openapi.test.ts`.
 */

import type { OpenApiConfiguration } from '@/hooks/api';

export type OpenApiSourceType = OpenApiConfiguration['source']['type'];

/** Everything the OpenAPI form edits, in one place, so "dirty" has one meaning. */
export type OpenApiValues = {
  title: string;
  path: string;
  sourceType: OpenApiSourceType;
  /** The pasted or uploaded document, the URL, or the repository path, depending on `sourceType`. */
  sourceValue: string;
};

/** Where a new reference is published unless the person picks another path. */
export const DEFAULT_OPENAPI_PATH = 'api-reference';

/** The text a source is edited as: its URL or repository path. An uploaded document is never sent back, so it edits as empty. */
export function sourceValueOf(source: OpenApiConfiguration['source']): string {
  if (source.type === 'url') return source.url;
  if (source.type === 'repository') return source.path;
  return '';
}

/**
 * The form's values for the site's configuration. With none yet, a new
 * reference: `defaultTitle`, the default path, and an upload.
 */
export function openApiValues(current: OpenApiConfiguration | null | undefined, defaultTitle: string): OpenApiValues {
  if (!current) return { title: defaultTitle, path: DEFAULT_OPENAPI_PATH, sourceType: 'upload', sourceValue: '' };
  return { title: current.title, path: current.path, sourceType: current.source.type, sourceValue: sourceValueOf(current.source) };
}

/** The value a source field starts at when the person switches to `next`: the saved one if it is that type, else empty. */
export const sourceValueFor = (current: OpenApiConfiguration | null | undefined, next: OpenApiSourceType) =>
  current?.source.type === next ? sourceValueOf(current.source) : '';

export type OpenApiSource = { type: 'upload'; content: string } | { type: 'url'; url: string } | { type: 'repository'; path: string };

/** What a save sends. An empty source field sends no source, so the server keeps the saved one. */
export function openApiUpsertBody(values: OpenApiValues): { title: string; path: string; source?: OpenApiSource } {
  const value = values.sourceValue.trim();
  let source: OpenApiSource | undefined;
  if (value) {
    if (values.sourceType === 'upload') source = { type: 'upload', content: values.sourceValue };
    else if (values.sourceType === 'url') source = { type: 'url', url: value };
    else source = { type: 'repository', path: value };
  }
  return { title: values.title.trim(), path: values.path.trim(), source };
}

/**
 * Whether Save can be pressed: a name and a path, and a source when there is
 * none yet or the person switched to another kind of source.
 */
export function canSaveOpenApi(values: OpenApiValues, current: OpenApiConfiguration | null | undefined): boolean {
  if (!values.title.trim() || !values.path.trim()) return false;
  const hasSource = Boolean(values.sourceValue.trim());
  if (!current) return hasSource;
  return values.sourceType === current.source.type || hasSource;
}

/**
 * What the server holds after saving `submitted` over `baseline`, in form
 * values: the trimmed text; an uploaded document is stored, not echoed back,
 * so its field empties; a save that sent no source kept the saved one.
 */
export function confirmedOpenApiValues(baseline: OpenApiValues, submitted: OpenApiValues): OpenApiValues {
  const { title, path, source } = openApiUpsertBody(submitted);
  if (!source) return { title, path, sourceType: baseline.sourceType, sourceValue: baseline.sourceValue };
  return { title, path, sourceType: source.type, sourceValue: source.type === 'upload' ? '' : sourceValueOf(source) };
}
