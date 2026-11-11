import { describe, expect, it } from 'vitest';
import { deriveSiteSlug } from './site-slug';

describe('site address derivation', () => {
  it.each([
    ['مركز المساعدة', 'site-0s7xtf9', true],
    ['وثائق جود 263', 'site-178xry5', true],
    ['Jood وثائق', 'jood', false],
    ['Acme Docs', 'acme-docs', false],
    ['وثائق جود للمساعدة X', 'site-12zr2ig', true],
  ] as const)('derives a usable address for %s without transliteration', (name, slug, needsCustomAddress) => {
    expect(deriveSiteSlug(name)).toEqual({ slug, needsCustomAddress });
  });

  it('uses the same neutral address after trimming and normalizing case', () => {
    expect(deriveSiteSlug('  وثائق جود للمساعدة x ')).toEqual(deriveSiteSlug('وثائق جود للمساعدة X'));
  });

  it('replaces digits-only and empty results instead of retaining leftovers', () => {
    expect(deriveSiteSlug('263').slug).toMatch(/^site-[a-z0-9]{7}$/);
    expect(deriveSiteSlug('📖').slug).toMatch(/^site-[a-z0-9]{7}$/);
  });

  it('caps a Latin address at the hostname limit without a trailing hyphen', () => {
    expect(deriveSiteSlug(`${'a'.repeat(62)} b`).slug).toBe('a'.repeat(62));
  });
  it('preserves the existing Latin slug derivation, including decomposed accents', () => {
    expect(deriveSiteSlug('Cafe\u0301 Docs')).toEqual({ slug: 'cafe-docs', needsCustomAddress: false });
  });
});
