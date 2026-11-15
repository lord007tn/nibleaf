import { describe, expect, it } from 'vitest';
import type { OpenApiConfiguration } from '@/hooks/api';
import { isDraftDirty, reconcileSaveSuccess, reconcileServerChange } from '@/lib/forms/server-draft';
import {
  canSaveOpenApi,
  confirmedOpenApiValues,
  DEFAULT_OPENAPI_PATH,
  type OpenApiValues,
  openApiUpsertBody,
  openApiValues,
  sourceValueFor,
  sourceValueOf,
} from './openapi';

const config = (source: OpenApiConfiguration['source'], overrides: Partial<OpenApiConfiguration> = {}): OpenApiConfiguration => ({
  title: 'Payments API',
  path: 'payments',
  contentHash: 'hash',
  updatedAt: '2026-11-01T10:00:00.000Z',
  source,
  ...overrides,
});
const urlConfig = config({ type: 'url', url: 'https://api.example.com/openapi.yaml' });
const values = (overrides: Partial<OpenApiValues> = {}): OpenApiValues => ({
  title: 'Payments API',
  path: 'payments',
  sourceType: 'url',
  sourceValue: 'https://api.example.com/openapi.yaml',
  ...overrides,
});

describe('openApiValues', () => {
  it('starts a new reference with the default name, path and an upload', () => {
    expect(openApiValues(null, 'OpenAPI')).toEqual({ title: 'OpenAPI', path: DEFAULT_OPENAPI_PATH, sourceType: 'upload', sourceValue: '' });
    expect(openApiValues(undefined, 'OpenAPI').path).toBe('api-reference');
  });

  it('edits each saved source as its URL, its repository path, or nothing for an upload', () => {
    expect(openApiValues(urlConfig, 'OpenAPI')).toEqual(values());
    expect(openApiValues(config({ type: 'repository', path: 'docs/openapi.yaml' }), 'OpenAPI').sourceValue).toBe('docs/openapi.yaml');
    expect(openApiValues(config({ type: 'upload' }), 'OpenAPI')).toEqual(values({ sourceType: 'upload', sourceValue: '' }));
    expect(sourceValueOf({ type: 'upload' })).toBe('');
  });
});

describe('sourceValueFor', () => {
  it('brings back the saved value when switching to the saved type, and empties otherwise', () => {
    expect(sourceValueFor(urlConfig, 'url')).toBe('https://api.example.com/openapi.yaml');
    expect(sourceValueFor(urlConfig, 'repository')).toBe('');
    expect(sourceValueFor(urlConfig, 'upload')).toBe('');
    expect(sourceValueFor(null, 'url')).toBe('');
  });
});

describe('openApiUpsertBody', () => {
  it('trims the name, path, URL and repository path', () => {
    expect(openApiUpsertBody(values({ title: ' Payments ', path: ' payments ', sourceValue: ' https://x.test/o.yaml ' }))).toEqual({
      title: 'Payments',
      path: 'payments',
      source: { type: 'url', url: 'https://x.test/o.yaml' },
    });
    expect(openApiUpsertBody(values({ sourceType: 'repository', sourceValue: ' docs/o.yaml ' })).source).toEqual({
      type: 'repository',
      path: 'docs/o.yaml',
    });
  });

  it('sends an uploaded document exactly as given', () => {
    expect(openApiUpsertBody(values({ sourceType: 'upload', sourceValue: '  openapi: 3.1.0\n' })).source).toEqual({
      type: 'upload',
      content: '  openapi: 3.1.0\n',
    });
  });

  it('sends no source when the field is empty, so the server keeps the saved one', () => {
    expect(openApiUpsertBody(values({ sourceType: 'upload', sourceValue: '   ' })).source).toBeUndefined();
  });
});

describe('canSaveOpenApi', () => {
  it('needs a name and a path', () => {
    expect(canSaveOpenApi(values({ title: ' ' }), urlConfig)).toBe(false);
    expect(canSaveOpenApi(values({ path: '' }), urlConfig)).toBe(false);
    expect(canSaveOpenApi(values(), urlConfig)).toBe(true);
  });

  it('needs a source for a new reference', () => {
    expect(canSaveOpenApi(openApiValues(null, 'OpenAPI'), null)).toBe(false);
    expect(canSaveOpenApi({ ...openApiValues(null, 'OpenAPI'), sourceValue: 'openapi: 3.1.0' }, null)).toBe(true);
  });

  it('needs a source only when switching to another kind', () => {
    const upload = config({ type: 'upload' });
    expect(canSaveOpenApi(values({ sourceType: 'upload', sourceValue: '' }), upload)).toBe(true);
    expect(canSaveOpenApi(values({ sourceType: 'url', sourceValue: '' }), upload)).toBe(false);
    expect(canSaveOpenApi(values({ sourceType: 'url', sourceValue: 'https://x.test' }), upload)).toBe(true);
  });
});

describe('confirmedOpenApiValues', () => {
  it('is what was sent, trimmed', () => {
    const submitted = values({ title: ' Billing ', sourceValue: ' https://x.test/o.yaml ' });
    expect(confirmedOpenApiValues(values(), submitted)).toEqual(values({ title: 'Billing', sourceValue: 'https://x.test/o.yaml' }));
  });

  it('empties an uploaded document, which the server stores but never echoes', () => {
    expect(confirmedOpenApiValues(values(), values({ sourceType: 'upload', sourceValue: 'openapi: 3.1.0' }))).toEqual(
      values({ sourceType: 'upload', sourceValue: '' }),
    );
  });

  it('keeps the saved source when none was sent', () => {
    expect(confirmedOpenApiValues(values(), values({ title: 'Billing', sourceValue: '' }))).toEqual(values({ title: 'Billing' }));
  });

  it('matches what the server then returns, so the refetch after a save leaves the form clean', () => {
    const submitted = values({ title: ' Billing ', path: 'billing' });
    const refetched = openApiValues(config(urlConfig.source, { title: 'Billing', path: 'billing' }), 'OpenAPI');
    expect(isDraftDirty(refetched, confirmedOpenApiValues(values(), submitted))).toBe(false);
  });
});

describe('the OpenAPI draft across server changes', () => {
  it('keeps an edited field when a refetch changes others', () => {
    const baseline = values();
    const current = values({ title: 'Billing API' });
    const next = openApiValues(config(urlConfig.source, { path: 'payments-v2' }), 'OpenAPI');
    const change = reconcileServerChange({ baseline, current, next });
    expect(change.current).toEqual(values({ title: 'Billing API', path: 'payments-v2' }));
    expect(change.conflicts).toEqual([]);
    expect(isDraftDirty(change.current, change.baseline)).toBe(true);
  });

  it('reports a field both sides changed as a conflict and keeps the edit', () => {
    const change = reconcileServerChange({ baseline: values(), current: values({ path: 'mine' }), next: values({ path: 'theirs' }) });
    expect(change.current.path).toBe('mine');
    expect(change.conflicts).toEqual(['path']);
  });

  it('is clean after a confirmed upload save', () => {
    const submitted = values({ sourceType: 'upload', sourceValue: 'openapi: 3.1.0' });
    const result = reconcileSaveSuccess({ submitted, current: submitted, confirmed: confirmedOpenApiValues(values(), submitted) });
    expect(isDraftDirty(result.current, result.baseline)).toBe(false);
    expect(result.current.sourceValue).toBe('');
  });
});
