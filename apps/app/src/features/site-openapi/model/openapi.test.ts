import { describe, expect, it } from 'vitest';
import { isDraftDirty, reconcileSaveSuccess, reconcileServerChange, resolveConflict } from '@/lib/forms/server-draft';
import {
  confirmedOpenApiValues,
  DEFAULT_OPENAPI_PATH,
  type OpenApiSavedSource,
  type OpenApiValues,
  openApiSaveBlocker,
  openApiUpsertBody,
  openApiValues,
  sourceValueOf,
  switchSource,
} from './openapi';

const URL_SOURCE = 'https://api.example.com/openapi.yaml';
const config = (source: OpenApiSavedSource, overrides: Partial<{ title: string; path: string }> = {}) => ({
  title: 'Payments API',
  path: 'payments',
  source,
  ...overrides,
});
const urlConfig = config({ type: 'url', url: URL_SOURCE });
const values = (overrides: Partial<OpenApiValues> = {}): OpenApiValues => ({
  title: 'Payments API',
  path: 'payments',
  source: { type: 'url', value: URL_SOURCE },
  ...overrides,
});

describe('openApiValues', () => {
  it('starts a new reference with the default name, path and an upload', () => {
    expect(openApiValues(null, 'OpenAPI')).toEqual({ title: 'OpenAPI', path: DEFAULT_OPENAPI_PATH, source: { type: 'upload', value: '' } });
    expect(openApiValues(undefined, 'OpenAPI').path).toBe('api-reference');
  });

  it('edits each saved source as its URL, its repository path, or nothing for an upload', () => {
    expect(openApiValues(urlConfig, 'OpenAPI')).toEqual(values());
    expect(openApiValues(config({ type: 'repository', path: 'docs/openapi.yaml' }), 'OpenAPI').source).toEqual({
      type: 'repository',
      value: 'docs/openapi.yaml',
    });
    expect(openApiValues(config({ type: 'upload' }), 'OpenAPI')).toEqual(values({ source: { type: 'upload', value: '' } }));
    expect(sourceValueOf({ type: 'upload' })).toBe('');
  });
});

describe('switchSource', () => {
  it('brings back the saved value when switching to the saved kind, and empties otherwise', () => {
    expect(switchSource(urlConfig, 'url')).toEqual({ type: 'url', value: URL_SOURCE });
    expect(switchSource(urlConfig, 'repository')).toEqual({ type: 'repository', value: '' });
    expect(switchSource(urlConfig, 'upload')).toEqual({ type: 'upload', value: '' });
    expect(switchSource(null, 'url')).toEqual({ type: 'url', value: '' });
  });
});

describe('openApiUpsertBody', () => {
  it('trims the name, path, URL and repository path', () => {
    expect(openApiUpsertBody(values({ title: ' Payments ', path: ' payments ', source: { type: 'url', value: ' https://x.test/o.yaml ' } }))).toEqual(
      {
        title: 'Payments',
        path: 'payments',
        source: { type: 'url', url: 'https://x.test/o.yaml' },
      },
    );
    expect(openApiUpsertBody(values({ source: { type: 'repository', value: ' docs/o.yaml ' } })).source).toEqual({
      type: 'repository',
      path: 'docs/o.yaml',
    });
  });

  it('sends an uploaded document exactly as given', () => {
    expect(openApiUpsertBody(values({ source: { type: 'upload', value: '  openapi: 3.1.0\n' } })).source).toEqual({
      type: 'upload',
      content: '  openapi: 3.1.0\n',
    });
  });

  it('sends no source when the field is empty, so the server keeps the saved one', () => {
    expect(openApiUpsertBody(values({ source: { type: 'upload', value: '   ' } })).source).toBeUndefined();
  });
});

describe('openApiSaveBlocker: whether Save can run', () => {
  it('needs a name and a path', () => {
    expect(openApiSaveBlocker(values({ title: ' ' }), urlConfig) === null).toBe(false);
    expect(openApiSaveBlocker(values({ path: '' }), urlConfig) === null).toBe(false);
    expect(openApiSaveBlocker(values(), urlConfig) === null).toBe(true);
  });

  it('needs a source for a new reference', () => {
    expect(openApiSaveBlocker(openApiValues(null, 'OpenAPI'), null) === null).toBe(false);
    expect(openApiSaveBlocker({ ...openApiValues(null, 'OpenAPI'), source: { type: 'upload', value: 'openapi: 3.1.0' } }, null) === null).toBe(true);
  });

  it('needs a source only when switching to another kind', () => {
    const upload = config({ type: 'upload' });
    expect(openApiSaveBlocker(values({ source: { type: 'upload', value: '' } }), upload) === null).toBe(true);
    expect(openApiSaveBlocker(values({ source: { type: 'url', value: '' } }), upload) === null).toBe(false);
    expect(openApiSaveBlocker(values({ source: { type: 'url', value: 'https://x.test' } }), upload) === null).toBe(true);
  });
});

describe('confirmedOpenApiValues', () => {
  it('is what was sent, trimmed', () => {
    const submitted = values({ title: ' Billing ', source: { type: 'url', value: ' https://x.test/o.yaml ' } });
    expect(confirmedOpenApiValues(values(), submitted)).toEqual(
      values({ title: 'Billing', source: { type: 'url', value: 'https://x.test/o.yaml' } }),
    );
  });

  it('empties an uploaded document, which the server stores but never echoes', () => {
    expect(confirmedOpenApiValues(values(), values({ source: { type: 'upload', value: 'openapi: 3.1.0' } }))).toEqual(
      values({ source: { type: 'upload', value: '' } }),
    );
  });

  it('keeps the saved source when none was sent', () => {
    expect(confirmedOpenApiValues(values(), values({ title: 'Billing', source: { type: 'url', value: '' } }))).toEqual(values({ title: 'Billing' }));
  });

  it('matches what the server then returns, so the refetch after a save leaves the form clean', () => {
    const submitted = values({ title: ' Billing ', path: 'billing' });
    const refetched = openApiValues(config(urlConfig.source, { title: 'Billing', path: 'billing' }), 'OpenAPI');
    expect(isDraftDirty(refetched, confirmedOpenApiValues(values(), submitted))).toBe(false);
  });
});

describe('the OpenAPI draft across server changes', () => {
  it('keeps an edited field when a refetch changes others', () => {
    const next = openApiValues(config(urlConfig.source, { path: 'payments-v2' }), 'OpenAPI');
    const change = reconcileServerChange({ baseline: values(), current: values({ title: 'Billing API' }), next });
    expect(change.current).toEqual(values({ title: 'Billing API', path: 'payments-v2' }));
    expect(change.conflicts).toEqual([]);
    expect(isDraftDirty(change.current, change.baseline)).toBe(true);
  });

  it('reports a field both sides changed as a conflict and keeps the edit', () => {
    const change = reconcileServerChange({ baseline: values(), current: values({ path: 'mine' }), next: values({ path: 'theirs' }) });
    expect(change.current.path).toBe('mine');
    expect(change.conflicts).toEqual(['path']);
  });

  it('never puts a document under a URL: the kind and the text move together', () => {
    const baseline = openApiValues(config({ type: 'upload' }), 'OpenAPI');
    const current = { ...baseline, source: { type: 'upload' as const, value: 'openapi: 3.1.0' } };
    // Meanwhile the server switched to a URL.
    const next = openApiValues(urlConfig, 'OpenAPI');
    const change = reconcileServerChange({ baseline, current, next });
    expect(change.current.source).toEqual({ type: 'upload', value: 'openapi: 3.1.0' });
    expect(change.conflicts).toEqual(['source']);
    // Keep mine sends the document as an upload; use theirs takes the URL whole.
    expect(openApiUpsertBody(resolveConflict({ baseline: change.baseline, current: change.current, key: 'source', choice: 'mine' })).source).toEqual({
      type: 'upload',
      content: 'openapi: 3.1.0',
    });
    expect(resolveConflict({ baseline: change.baseline, current: change.current, key: 'source', choice: 'theirs' }).source).toEqual({
      type: 'url',
      value: URL_SOURCE,
    });
  });

  it('takes a server source change whole when the source wasn’t edited', () => {
    const baseline = openApiValues(config({ type: 'upload' }), 'OpenAPI');
    const change = reconcileServerChange({ baseline, current: { ...baseline, title: 'Billing API' }, next: openApiValues(urlConfig, 'OpenAPI') });
    expect(change.current).toEqual(values({ title: 'Billing API' }));
    expect(change.conflicts).toEqual([]);
  });

  it('is clean after a confirmed upload save', () => {
    const submitted = values({ source: { type: 'upload', value: 'openapi: 3.1.0' } });
    const result = reconcileSaveSuccess({ submitted, current: submitted, confirmed: confirmedOpenApiValues(values(), submitted) });
    expect(isDraftDirty(result.current, result.baseline)).toBe(false);
    expect(result.current.source.value).toBe('');
  });
});

describe('openApiSaveBlocker', () => {
  it('names what is missing: the name and address first, then the document', () => {
    expect(openApiSaveBlocker({ ...openApiValues(null, 'OpenAPI'), title: '' }, null)).toBe('settings.openapi.needNameAndPath');
    expect(openApiSaveBlocker(openApiValues(null, 'OpenAPI'), null)).toBe('settings.openapi.needSource');
    expect(openApiSaveBlocker({ ...openApiValues(null, 'OpenAPI'), source: { type: 'upload', value: 'openapi: 3.1.0' } }, null)).toBeNull();
  });
});
