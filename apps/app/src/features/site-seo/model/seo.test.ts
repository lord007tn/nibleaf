import { describe, expect, it } from 'vitest';
import { languageSeoConfig, projectSeoPatch, seoPlaceholders, seoValues, uploadResultAction } from './seo';

const BLANK = { metaTitle: '', metaDescription: '', socialImage: '', allowIndex: true };

describe('seoValues', () => {
  it('reads an unset scope as blank text that allows indexing', () => {
    expect(seoValues(undefined)).toStrictEqual(BLANK);
    expect(seoValues(null)).toStrictEqual(BLANK);
    expect(seoValues({})).toStrictEqual(BLANK);
  });

  it('keeps stored values, including an explicit false', () => {
    expect(seoValues({ metaTitle: 'Docs', metaDescription: 'All of it', socialImage: '/og/cover.png', allowIndex: false })).toStrictEqual({
      metaTitle: 'Docs',
      metaDescription: 'All of it',
      socialImage: '/og/cover.png',
      allowIndex: false,
    });
  });
});

describe('projectSeoPatch', () => {
  it('sends all four values, trimmed, with a cleared text as ""', () => {
    expect(projectSeoPatch({ metaTitle: '  Docs ', metaDescription: ' ', socialImage: '', allowIndex: false })).toStrictEqual({
      metaTitle: 'Docs',
      metaDescription: '',
      socialImage: '',
      allowIndex: false,
    });
  });

  it('keeps a relative or absolute social image as typed (the validator owns the scheme check)', () => {
    expect(projectSeoPatch({ ...BLANK, socialImage: ' /og/cover.png ' }).socialImage).toBe('/og/cover.png');
    expect(projectSeoPatch({ ...BLANK, socialImage: 'https://cdn.example/og.png' }).socialImage).toBe('https://cdn.example/og.png');
  });
});

describe('languageSeoConfig', () => {
  it('is null with nothing to override, so the server clears the language SEO and keeps its other sections', () => {
    expect(languageSeoConfig(BLANK)).toBeNull();
    expect(languageSeoConfig({ ...BLANK, metaTitle: '   ', metaDescription: '\n' })).toBeNull();
  });

  it.each([
    ['a title', { metaTitle: ' Titre ' }, { metaTitle: 'Titre' }],
    ['a description', { metaDescription: 'Tout' }, { metaDescription: 'Tout' }],
    ['a social image', { socialImage: '/og/fr.png' }, { socialImage: '/og/fr.png' }],
    ['indexing off', { allowIndex: false }, { allowIndex: false }],
  ])('overrides with %s, sending all four values', (_, change, stored) => {
    expect(languageSeoConfig({ ...BLANK, ...change })).toStrictEqual({ seo: { ...BLANK, ...stored } });
  });
});

describe('seoPlaceholders', () => {
  const site = { name: 'Acme', description: 'Acme docs' };

  it('falls back to the site name and description in the project scope, whatever the saved SEO', () => {
    expect(seoPlaceholders('project', { metaTitle: 'Saved', socialImage: '/og/a.png' }, site)).toStrictEqual({
      metaTitle: 'Acme',
      metaDescription: 'Acme docs',
      socialImage: '/og/cover.png',
    });
    expect(seoPlaceholders('project', undefined, { name: 'Acme', description: null }).metaDescription).toBeUndefined();
  });

  it("shows what a language inherits: the project's SEO, else the site name and description", () => {
    expect(seoPlaceholders('language', { metaTitle: 'Docs', metaDescription: '', socialImage: '/og/a.png' }, site)).toStrictEqual({
      metaTitle: 'Docs',
      metaDescription: 'Acme docs',
      socialImage: '/og/a.png',
    });
    expect(seoPlaceholders('language', undefined, site)).toStrictEqual({
      metaTitle: 'Acme',
      metaDescription: 'Acme docs',
      socialImage: '/og/cover.png',
    });
  });
});

describe('uploadResultAction', () => {
  const request = { draft: 2, edits: 5, startedFrom: '/og/old.png' };

  it('applies while the draft, the edit count and the value are unchanged', () => {
    expect(uploadResultAction(request, { draft: 2, edits: 5, value: '/og/old.png' })).toBe('apply');
  });

  it('is stale once the draft is gone (discard, another scope or site), whatever the field holds', () => {
    expect(uploadResultAction(request, { draft: 3, edits: 5, value: '/og/old.png' })).toBe('stale');
  });

  it('is superseded by an edit, even one typed back to the old value, and by a server change', () => {
    expect(uploadResultAction(request, { draft: 2, edits: 7, value: '/og/old.png' })).toBe('superseded');
    expect(uploadResultAction(request, { draft: 2, edits: 6, value: '' })).toBe('superseded');
    expect(uploadResultAction(request, { draft: 2, edits: 5, value: '/og/theirs.png' })).toBe('superseded');
  });
});
