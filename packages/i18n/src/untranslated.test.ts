import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as guard from '../scripts/untranslated.mjs';

type Catalog = Record<string, unknown>;
const { baseCatalog, catalog, exceptions, keepTerms, locales, nextPending, onlyKeptTerms, parityProblems, pendingGrowth, untranslatedKeys } =
  guard as {
    baseCatalog: (base?: string) => Catalog;
    catalog: (locale: string) => Catalog;
    exceptions: (locale: string) => { sameAsEnglish: string[]; pending: string[] };
    keepTerms: () => string[];
    locales: () => string[];
    nextPending: (state: { leftovers: string[]; sameAsEnglish: string[]; pending: string[]; exists: boolean }) => string[];
    onlyKeptTerms: (text: string, keep: string[]) => boolean;
    parityProblems: (english: Catalog, messages: Catalog) => string[];
    pendingGrowth: (english: Catalog, basePending: string[], pending: string[]) => string[];
    untranslatedKeys: (english: Catalog, messages: Catalog, keep: string[], previousEnglish?: Catalog, sameAsEnglish?: string[]) => string[];
  };

const english = catalog('en');
const previousEnglish = baseCatalog();
const keep = keepTerms();
const translated = locales().filter((locale) => locale !== 'en');
const refreshAdvice =
  'Refresh the locale fallback to the current English value and keep the key in pending, translate it, or list it in sameAsEnglish';

describe('untranslated strings', () => {
  // A value identical to English must be translated, or listed in
  // untranslated/<locale>.json: `sameAsEnglish` on purpose, `pending` until done.
  it.each(translated)('%s translates every string or lists it', (locale) => {
    const { sameAsEnglish, pending } = exceptions(locale);
    const listed = new Set([...sameAsEnglish, ...pending]);
    expect(untranslatedKeys(english, catalog(locale), keep, previousEnglish, sameAsEnglish).filter((key) => !listed.has(key))).toEqual([]);
  });

  // `pending` only shrinks: a key translated since must leave the list (run
  // `pnpm --filter @nibleaf/i18n run untranslated -- --baseline <locale>`).
  it.each(translated)('%s keeps pending identical to current English and exceptions on existing keys', (locale) => {
    const { sameAsEnglish, pending } = exceptions(locale);
    const messages = catalog(locale);
    const leftovers = new Set(untranslatedKeys(english, messages, keep, previousEnglish, sameAsEnglish));
    expect(pending.filter((key) => !leftovers.has(key))).toEqual([]);
    // An intentional old-English term remains valid after its history is gone.
    expect(sameAsEnglish.filter((key) => !(key in english) || !(key in messages))).toEqual([]);
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
      for (const dir of ['scripts', 'messages', 'untranslated', 'project.inlang', 'glossary'])
        mkdirSync(join(fixture, relativeRoot, dir), { recursive: true });
      copyFileSync(new URL('../scripts/untranslated.mjs', import.meta.url), join(fixture, relativeRoot, 'scripts/untranslated.mjs'));
      write('messages/en.json', { existing: 'Save', example: 'Old English help' });
      write('messages/de.json', { existing: 'Speichern', example: 'Old English help' });
      write('glossary/terms.json', { doNotTranslate: ['GitHub'] });
      write('project.inlang/settings.json', { locales: ['en', 'de'] });
      git('init', '-b', 'main');
      git('add', '.');
      const commit = () =>
        git('-c', 'user.name=Test', '-c', 'user.email=test@example.test', '-c', 'commit.gpgsign=false', 'commit', '-m', 'baseline');
      commit();
      write('untranslated/de.json', { pending: ['example'] });
      const run = (args = ['--check-base', 'HEAD']) =>
        spawnSync(process.execPath, ['scripts/untranslated.mjs', ...args], { cwd: join(fixture, relativeRoot), encoding: 'utf8' });
      // Initial guard adoption has no baseline to compare yet.
      expect(run().status).toBe(0);
      git('add', '.');
      commit();
      git('update-ref', 'refs/remotes/origin/main', 'HEAD');
      write('untranslated/de.json', { pending: ['existing', 'example'] });
      const regression = run();
      expect(regression.status).not.toBe(0);
      expect(regression.stderr).toContain('pending grew from HEAD: existing');
      write('untranslated/de.json', { pending: ['example', 'new_key'] });
      expect(run().status).toBe(0);

      // A PR changes only English, then attempts the normal baseline shrink.
      write('untranslated/de.json', { pending: ['example'] });
      git('switch', '-c', 'refresh-fallback');
      write('messages/en.json', { existing: 'Save', example: 'New English help' });
      git('add', '.');
      commit();
      const baseArgs = ['--check-base', 'origin/main'];
      const oldCopy = run(baseArgs);
      expect(oldCopy.status).not.toBe(0);
      expect(oldCopy.stderr).toContain('example');
      expect(oldCopy.stderr).toContain(refreshAdvice);
      const baselinePath = join(fixture, relativeRoot, 'untranslated/de.json');
      const beforeBaseline = readFileSync(baselinePath, 'utf8');
      const oldBaseline = run(['--baseline', 'de']);
      expect(oldBaseline.status).not.toBe(0);
      expect(oldBaseline.stderr).toContain(refreshAdvice);
      expect(readFileSync(baselinePath, 'utf8')).toBe(beforeBaseline);
      const baseline = () => JSON.parse(readFileSync(join(fixture, relativeRoot, 'untranslated/de.json'), 'utf8'));
      expect(baseline().pending).toEqual(['example']);
      write('untranslated/de.json', { pending: [] });
      const pruned = run(baseArgs);
      expect(pruned.status).not.toBe(0);
      expect(pruned.stderr).toContain(refreshAdvice);

      // A genuine translation may leave pending, including through --baseline.
      write('untranslated/de.json', { pending: ['example'] });
      write('messages/de.json', { existing: 'Speichern', example: 'Neue Hilfe' });
      expect(run(['--baseline', 'de']).status).toBe(0);
      expect(baseline().pending).toEqual([]);
      expect(run(baseArgs).status).toBe(0);

      // Deliberately unchanged terms remain allowed even after English changes.
      write('messages/de.json', { existing: 'Speichern', example: 'Old English help' });
      write('untranslated/de.json', { sameAsEnglish: ['example'], pending: [] });
      expect(run(['--baseline', 'de']).status).toBe(0);
      expect(baseline()).toEqual({ sameAsEnglish: ['example'], pending: [] });
      expect(run(baseArgs).status).toBe(0);

      // Refreshing the fallback makes pending independent of Git history.
      write('messages/de.json', { existing: 'Speichern', example: 'New English help' });
      write('untranslated/de.json', { pending: ['example'] });
      expect(run(baseArgs).status).toBe(0);
      expect(run(['--baseline', 'de']).status).toBe(0);
      expect(baseline().pending).toEqual(['example']);
      git('add', '.');
      commit();

      // Main advances independently, then receives the refreshed PR by a real merge.
      git('switch', 'main');
      writeFileSync(join(fixture, 'unrelated.txt'), 'main advanced');
      git('add', '.');
      commit();
      git('update-ref', 'refs/remotes/origin/main', 'HEAD');
      git('switch', 'refresh-fallback');
      expect(run(baseArgs).status).toBe(0);
      git('switch', 'main');
      git(
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.test',
        '-c',
        'commit.gpgsign=false',
        'merge',
        '--no-ff',
        'refresh-fallback',
        '-m',
        'merge',
      );
      git('update-ref', 'refs/remotes/origin/main', 'HEAD');
      expect(run(baseArgs).status).toBe(0);
      expect(run(['--baseline', 'de']).status).toBe(0);
      expect(baseline().pending).toEqual(['example']);

      // Main-push CI and the next unrelated commit still see ordinary current-English pending.
      writeFileSync(join(fixture, 'unrelated.txt'), 'another unrelated commit');
      git('add', '.');
      commit();
      git('update-ref', 'refs/remotes/origin/main', 'HEAD');
      expect(run(baseArgs).status).toBe(0);
      expect(run(['--baseline', 'de']).status).toBe(0);
      expect(baseline().pending).toEqual(['example']);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  }, 30_000);

  it('uses the common ancestor when main independently changes the same English key', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'nibleaf-i18n-divergent-'));
    const relativeRoot = 'packages/i18n/';
    const write = (path: string, value: unknown) => writeFileSync(join(fixture, relativeRoot, path), JSON.stringify(value));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: fixture, stdio: 'pipe' });
    const commit = () => git('-c', 'user.name=Test', '-c', 'user.email=test@example.test', '-c', 'commit.gpgsign=false', 'commit', '-am', 'fixture');
    try {
      for (const dir of ['scripts', 'messages', 'untranslated', 'project.inlang', 'glossary'])
        mkdirSync(join(fixture, relativeRoot, dir), { recursive: true });
      copyFileSync(new URL('../scripts/untranslated.mjs', import.meta.url), join(fixture, relativeRoot, 'scripts/untranslated.mjs'));
      write('messages/en.json', { example: 'Old English help' });
      write('messages/de.json', { example: 'Old English help' });
      write('untranslated/de.json', { pending: ['example'] });
      write('glossary/terms.json', { doNotTranslate: [] });
      write('project.inlang/settings.json', { locales: ['en', 'de'] });
      git('init', '-b', 'main');
      git('add', '.');
      commit();
      git('branch', 'feature');
      write('messages/en.json', { example: 'Independent main English help' });
      commit();
      git('update-ref', 'refs/remotes/origin/main', 'HEAD');
      git('switch', 'feature');
      write('messages/en.json', { example: 'New English help' });
      commit();
      const stale = spawnSync(process.execPath, ['scripts/untranslated.mjs', '--baseline', 'de'], {
        cwd: join(fixture, relativeRoot),
        encoding: 'utf8',
      });
      expect(stale.status).not.toBe(0);
      expect(stale.stderr).toContain(refreshAdvice);
      write('messages/de.json', { example: 'New English help' });
      const refreshed = spawnSync(process.execPath, ['scripts/untranslated.mjs', '--baseline', 'de'], {
        cwd: join(fixture, relativeRoot),
        encoding: 'utf8',
      });
      expect(refreshed.status).toBe(0);
      expect(JSON.parse(readFileSync(join(fixture, relativeRoot, 'untranslated/de.json'), 'utf8')).pending).toEqual(['example']);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  }, 30_000);

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

  it('rejects copies of the previous English value with actionable refresh guidance', () => {
    expect(() =>
      untranslatedKeys({ example: 'New English help' }, { example: ' Old  English help ' }, keep, { example: 'Old English help' }),
    ).toThrow(refreshAdvice);
  });

  it('keeps a refreshed fallback pending before and after its Git history disappears', () => {
    const current = { example: 'New English help' };
    for (const base of [{ example: 'Old English help' }, current]) {
      const leftovers = untranslatedKeys(current, current, keep, base);
      expect(leftovers).toEqual(['example']);
      expect(nextPending({ leftovers, sameAsEnglish: [], pending: ['example'], exists: true })).toEqual(['example']);
    }
  });

  it('allows intentional old-English terms through sameAsEnglish with or without base history', () => {
    for (const base of [{ example: 'Old English help' }, { example: 'New English help' }]) {
      expect(untranslatedKeys({ example: 'New English help' }, { example: 'Old English help' }, keep, base, ['example'])).toEqual([]);
    }
  });

  it('rejects an old-English plural message and accepts its refreshed fallback', () => {
    const plural = (noun: string) => [
      { declarations: ['input count'], selectors: ['count'], match: { 'count=one': `{count} ${noun}`, 'count=*': `{count} ${noun}s` } },
    ];
    const base = { example: plural('page') };
    const current = { example: plural('document') };
    expect(() => untranslatedKeys(current, base, keep, base)).toThrow(refreshAdvice);
    expect(untranslatedKeys(current, current, keep, base)).toEqual(['example']);
  });

  it('allows genuine translations, new keys and kept terms after English changes', () => {
    expect(
      untranslatedKeys(
        { example: 'New English help', brand: 'Connect GitHub', added: 'New message' },
        { example: 'Neue Hilfe', brand: 'GitHub', added: 'Neue Nachricht' },
        keep,
        { example: 'Old English help', brand: 'GitHub' },
      ),
    ).toEqual([]);
    expect(untranslatedKeys({ added: 'New message' }, { added: 'New message' }, keep, {})).toEqual(['added']);
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
