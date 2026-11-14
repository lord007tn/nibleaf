import { describe, expect, it } from 'vitest';
import * as guard from '../scripts/untranslated.mjs';

type Catalog = Record<string, unknown>;
const { catalog, exceptions, keepTerms, locales, onlyKeptTerms, parityProblems, untranslatedKeys } = guard as {
  catalog: (locale: string) => Catalog;
  exceptions: (locale: string) => { sameAsEnglish: string[]; pending: string[] };
  keepTerms: () => string[];
  locales: () => string[];
  onlyKeptTerms: (text: string, keep: string[]) => boolean;
  parityProblems: (english: Catalog, messages: Catalog) => string[];
  untranslatedKeys: (english: Catalog, messages: Catalog, keep: string[]) => string[];
};

const english = catalog('en');
const keep = keepTerms();
const translated = locales().filter((locale) => locale !== 'en');

describe('untranslated strings', () => {
  // A value identical to English must be translated, or listed in
  // untranslated/<locale>.json: `sameAsEnglish` on purpose, `pending` until done.
  it.each(translated)('%s translates every string or lists it', (locale) => {
    const { sameAsEnglish, pending } = exceptions(locale);
    const listed = new Set([...sameAsEnglish, ...pending]);
    expect(untranslatedKeys(english, catalog(locale), keep).filter((key) => !listed.has(key))).toEqual([]);
  });

  // `pending` only shrinks: a key translated since must leave the list (run
  // `pnpm --filter @nibleaf/i18n run untranslated -- --baseline <locale>`).
  it.each(translated)('%s lists only strings that are still identical to English', (locale) => {
    const { sameAsEnglish, pending } = exceptions(locale);
    const leftovers = new Set(untranslatedKeys(english, catalog(locale), keep));
    expect([...sameAsEnglish, ...pending].filter((key) => !leftovers.has(key))).toEqual([]);
    expect(sameAsEnglish.filter((key) => pending.includes(key))).toEqual([]);
  });
});

describe('catalog parity with English', () => {
  it.each(translated)('%s keeps every key, plural shape and placeholder', (locale) => {
    expect(parityProblems(english, catalog(locale))).toEqual([]);
  });
});

describe('the untranslated check', () => {
  it('accepts strings made only of kept terms, numbers, punctuation and placeholders', () => {
    expect(onlyKeptTerms('GitHub', keep)).toBe(true);
    expect(onlyKeptTerms('{count} MB', keep)).toBe(true);
    expect(onlyKeptTerms('LCP · INP · CLS', keep)).toBe(true);
    expect(onlyKeptTerms('robots.txt', keep)).toBe(true);
  });

  it('still asks for translation when a kept term sits in a sentence', () => {
    expect(onlyKeptTerms('Connect GitHub', keep)).toBe(false);
    expect(onlyKeptTerms('API key', keep)).toBe(false);
    // A kept term inside a longer word is not the term.
    expect(onlyKeptTerms('Gitter', keep)).toBe(false);
  });

  it('flags identical values and leaves translated ones alone', () => {
    const en = { a: 'Save changes', b: 'GitHub', c: 'Delete' };
    expect(untranslatedKeys(en, { a: 'Save changes', b: 'GitHub', c: 'Löschen' }, keep)).toEqual(['a']);
  });

  it('reports lost, unknown and missing placeholders and keys', () => {
    const plural = [{ declarations: ['input count'], selectors: ['count'], match: { 'count=one': '{count} page', 'count=*': '{count} pages' } }];
    const en = { a: 'Hi {name}', b: plural, c: 'Done', e: 'Gone' };
    expect(parityProblems(en, { a: 'Hallo', b: '{count} Seiten', c: 'Fertig {x}', d: 'extra' })).toEqual([
      'a: placeholders [] vs English ["name"]',
      'c: placeholders ["x"] vs English []',
      'e: missing',
      'd: not in English',
    ]);
    // A language without plural forms may use a plain string for a plural message.
    expect(parityProblems({ b: plural }, { b: '{count} 页' })).toEqual([]);
    // A plural form may spell its number out, but never use another placeholder.
    const spelled = [{ declarations: ['input count'], selectors: ['count'], match: { 'count=one': 'eine Seite', 'count=*': '{count} Seiten' } }];
    expect(parityProblems({ b: plural }, { b: spelled })).toEqual([]);
    const other = [{ declarations: ['input count'], selectors: ['count'], match: { 'count=one': '{n} Seite', 'count=*': '{count} Seiten' } }];
    expect(parityProblems({ b: plural }, { b: other })).toEqual(['b: placeholders ["count","n"] vs English ["count"]']);
  });
});
