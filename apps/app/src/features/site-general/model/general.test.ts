import { describe, expect, it } from 'vitest';
import {
  type GeneralValues,
  generalSaveRequests,
  generalValues,
  nameProblem,
  normalizeBaseDomain,
  siteAddressPreview,
  slugProblem,
  slugRefusal,
  translationChooser,
} from './general';

const languages = [
  { id: 'ar', isDefault: false, position: 2, translation: { name: 'التوثيق', description: null } },
  { id: 'en', isDefault: true, position: 0, translation: null },
  { id: 'fr', isDefault: false, position: 1 },
];

const baseline: GeneralValues = {
  name: 'Docs',
  slug: 'docs',
  description: 'Product docs',
  icon: null,
  translations: { fr: { name: '', description: '' }, ar: { name: 'التوثيق', description: '' } },
};

describe('generalValues', () => {
  it('normalizes the site and lists translations for non-default languages only, in language order', () => {
    const values = generalValues({ name: 'Docs', slug: 'docs', description: null, icon: undefined }, languages);
    expect(values).toEqual({ name: 'Docs', slug: 'docs', description: '', icon: null, translations: baseline.translations });
    expect(Object.keys(values.translations)).toEqual(['fr', 'ar']);
  });
});

describe('validation', () => {
  it('requires a name', () => {
    expect(nameProblem('  ')).toBe('required');
    expect(nameProblem('Docs')).toBeUndefined();
  });

  it.each([
    ['', 'required'],
    ['Docs', 'format'],
    ['-docs', 'format'],
    ['docs-', 'format'],
    ['a'.repeat(64), 'format'],
    ['docs', 'reserved'],
    ['www', 'reserved'],
    ['xn--docs', 'reserved'],
    ['documentation', undefined],
    ['my-docs-2', undefined],
    ['a'.repeat(63), undefined],
  ])('slug %j → %s', (value, problem) => {
    expect(slugProblem(value)).toBe(problem);
  });

  // P0-DASH-001: the first site on older instances was given `docs`.
  it('accepts a reserved address the site already has, but not one it changes to', () => {
    expect(slugProblem('docs', 'docs')).toBeUndefined();
    expect(slugProblem('www', 'docs')).toBe('reserved');
  });
});

describe('generalSaveRequests', () => {
  it('sends nothing when nothing changed, ignoring whitespace-only edits', () => {
    expect(generalSaveRequests(baseline, { ...baseline, name: ' Docs ' })).toEqual({ project: null, translations: [] });
  });

  it('sends one project update with only the changed fields, trimmed, and a null empty description', () => {
    expect(generalSaveRequests(baseline, { ...baseline, name: ' Help ', description: '  ', icon: '🚀' }).project).toEqual({
      name: 'Help',
      description: null,
      icon: '🚀',
    });
  });

  // P0-DASH-001: re-sending the unchanged `docs` made every save fail.
  it('never re-sends an address that did not change', () => {
    expect(generalSaveRequests(baseline, { ...baseline, description: 'Edited' }).project).toEqual({ description: 'Edited' });
    expect(generalSaveRequests(baseline, { ...baseline, slug: ' handbook ' }).project).toEqual({ slug: 'handbook' });
  });

  it('sends one update per changed translation and clears an emptied one', () => {
    const submitted = {
      ...baseline,
      translations: { fr: { name: 'Documentation', description: '' }, ar: { name: ' ', description: '' } },
    };
    expect(generalSaveRequests(baseline, submitted)).toEqual({
      project: null,
      translations: [
        { id: 'fr', translation: { name: 'Documentation', description: '' } },
        { id: 'ar', translation: null },
      ],
    });
  });
});

describe('translationChooser', () => {
  it.each([
    [0, 'none'],
    [1, 'single'],
    [2, 'segmented'],
    [3, 'segmented'],
    [4, 'select'],
  ] as const)('%i extra languages → %s', (count, chooser) => {
    expect(translationChooser(count)).toBe(chooser);
  });
});

describe('site address', () => {
  it('previews the free subdomain only when a base domain is configured', () => {
    expect(siteAddressPreview('docs', 'nibleaf.app', 'p1')).toBe('docs.nibleaf.app');
    expect(siteAddressPreview('', 'nibleaf.app', 'p1')).toBe('.nibleaf.app');
    expect(siteAddressPreview('docs', undefined, 'p1')).toBe('/sites/p1');
  });

  it('normalizes the configured base domain', () => {
    expect(normalizeBaseDomain('*.nibleaf.app.')).toBe('nibleaf.app');
    expect(normalizeBaseDomain('')).toBeUndefined();
    expect(normalizeBaseDomain(undefined)).toBeUndefined();
  });

  it.each([
    [{ status: 409, details: { slug: 'docs' } }, 'taken'],
    [{ status: 400, code: 'http:bad_request', details: { reason: 'slug_reserved' } }, 'reserved'],
    [{ status: 422, code: 'validation:failed', details: { issues: [{ path: ['slug'], message: 'Invalid' }] } }, 'format'],
    [{ status: 422, code: 'validation:failed', details: { issues: [{ path: [{ key: 'slug' }], message: 'Invalid' }] } }, 'format'],
    [{ status: 422, code: 'validation:failed', details: { issues: [{ path: ['name'], message: 'Too long' }] } }, undefined],
    [{ status: 409, details: {} }, undefined],
    [{ status: 400, details: { reason: 'other' } }, undefined],
    [{ status: 500, details: { slug: 'docs' } }, undefined],
    ['nope', undefined],
  ])('reads the server refusing the address: %j → %s', (error, refusal) => {
    expect(slugRefusal(error)).toBe(refusal);
  });
});
