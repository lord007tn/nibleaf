import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as guard from '../scripts/untranslated.mjs';

type Catalog = Record<string, unknown>;
const { catalog, exceptions, keepTerms, locales, nextPending, onlyKeptTerms, parityProblems, pendingGrowth, untranslatedKeys } = guard as {
  catalog: (locale: string) => Catalog;
  exceptions: (locale: string) => { sameAsEnglish: string[]; pending: string[] };
  keepTerms: () => string[];
  locales: () => string[];
  nextPending: (state: { leftovers: string[]; sameAsEnglish: string[]; pending: string[]; exists: boolean }) => string[];
  onlyKeptTerms: (text: string, keep: string[]) => boolean;
  parityProblems: (english: Catalog, messages: Catalog) => string[];
  pendingGrowth: (english: Catalog, basePending: string[], pending: string[]) => string[];
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
  it('preserves malformed baselines instead of resetting them', () => {
    const locale = `test-${randomUUID()}`;
    const file = new URL(`../untranslated/${locale}.json`, import.meta.url);
    expect(exceptions(locale)).toEqual({ sameAsEnglish: [], pending: [], exists: false });
    writeFileSync(file, '{invalid');
    try {
      expect(() => exceptions(locale)).toThrow(SyntaxError);
    } finally {
      rmSync(file);
    }
  });

  it('rejects re-listing translated keys against the base but permits new catalog keys', () => {
    const baseEnglish = { translated: 'Save', pending: 'Delete' };
    expect(pendingGrowth(baseEnglish, ['pending'], ['pending'])).toEqual([]);
    expect(pendingGrowth(baseEnglish, ['pending'], [])).toEqual([]);
    expect(pendingGrowth(baseEnglish, ['pending'], ['translated', 'new_key'])).toEqual(['translated']);
    expect(pendingGrowth(baseEnglish, [], ['translated'])).toEqual(['translated']);
  });

  it('enforces the base comparison through the CI command from any working directory', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'nibleaf-i18n-base-'));
    const relativeRoot = 'packages/i18n/';
    const write = (path: string, value: unknown) => writeFileSync(join(fixture, relativeRoot, path), JSON.stringify(value));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: fixture, stdio: 'pipe' });
    try {
      for (const dir of ['scripts', 'messages', 'untranslated', 'project.inlang']) mkdirSync(join(fixture, relativeRoot, dir), { recursive: true });
      copyFileSync(new URL('../scripts/untranslated.mjs', import.meta.url), join(fixture, relativeRoot, 'scripts/untranslated.mjs'));
      write('messages/en.json', { existing: 'Save' });
      write('project.inlang/settings.json', { locales: ['en', 'de'] });
      git('init');
      git('add', '.');
      const commit = () =>
        git('-c', 'user.name=Test', '-c', 'user.email=test@example.test', '-c', 'commit.gpgsign=false', 'commit', '-m', 'baseline');
      commit();
      write('untranslated/de.json', { pending: ['existing'] });
      const run = () =>
        spawnSync(process.execPath, ['scripts/untranslated.mjs', '--check-base', 'HEAD'], { cwd: join(fixture, relativeRoot), encoding: 'utf8' });
      // Initial guard adoption has no baseline to compare yet.
      expect(run().status).toBe(0);
      write('untranslated/de.json', { pending: [] });
      git('add', '.');
      commit();
      write('untranslated/de.json', { pending: ['existing'] });
      const regression = run();
      expect(regression.status).not.toBe(0);
      expect(regression.stderr).toContain('pending grew from HEAD: existing');
      write('untranslated/de.json', { pending: ['new_key'] });
      expect(run().status).toBe(0);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

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

  it('treats a copy that only differs in whitespace as untranslated', () => {
    expect(untranslatedKeys({ a: 'Save changes' }, { a: ' Save  changes ' }, keep)).toEqual(['a']);
  });

  it('only ever shrinks pending once a locale has a baseline, even an empty one', () => {
    const base = { sameAsEnglish: ['same'], exists: true };
    expect(nextPending({ ...base, leftovers: ['a', 'same'], pending: ['a', 'b'] })).toEqual(['a']);
    // A finished locale (empty pending) that regresses must not be re-listed.
    expect(() => nextPending({ ...base, leftovers: ['a'], pending: [] })).toThrow(/refusing to add 1 keys/);
    expect(() => nextPending({ ...base, leftovers: ['a', 'c'], pending: ['a'] })).toThrow(/refusing to add 1 keys to pending \(c\)/);
    // Only a locale with no baseline file yet starts one.
    expect(nextPending({ sameAsEnglish: [], pending: [], exists: false, leftovers: ['a', 'b'] })).toEqual(['a', 'b']);
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
