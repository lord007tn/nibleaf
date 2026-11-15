#!/usr/bin/env node
// Untranslated strings and placeholder parity for the message catalogs.
//
//   pnpm --filter @nibleaf/i18n run untranslated            every locale's pending count
//   pnpm --filter @nibleaf/i18n run untranslated de         de's pending keys and leftovers
//   pnpm --filter @nibleaf/i18n run untranslated -- --baseline de
//                                                           rewrite untranslated/de.json's pending list
//                                                           from the catalog (only ever to shrink it)
//
// A string is untranslated when its value is the current English one, unless
// nothing translatable is left once {placeholders}, glossary doNotTranslate
// terms, numbers and punctuation are taken out ("GitHub", "{count} MB").
// untranslated/<locale>.json lists the exceptions: `sameAsEnglish` (identical
// on purpose, e.g. a loanword the locale uses as is) and `pending` (not
// translated yet; it only shrinks). src/untranslated.test.ts enforces both.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
export const readJson = (relative) => JSON.parse(readFileSync(new URL(relative, root), 'utf8'));

export const locales = () => readJson('project.inlang/settings.json').locales;
export const catalog = (locale) => {
  const { $schema: _schema, ...messages } = readJson(`messages/${locale}.json`);
  return messages;
};
export const keepTerms = () => readJson('glossary/terms.json').doNotTranslate;
export const exceptions = (locale) => {
  try {
    const { sameAsEnglish = [], pending = [] } = readJson(`untranslated/${locale}.json`);
    return { sameAsEnglish, pending, exists: true };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { sameAsEnglish: [], pending: [], exists: false };
  }
};

const git = (...args) => execFileSync('git', args, { cwd: new URL('../../', root), encoding: 'utf8' });

/** Local PR base, or HEAD before the first origin/main fetch (including initial adoption). */
export function baseCatalog(base) {
  let revision = base;
  if (!revision) {
    const main = git('for-each-ref', '--format=%(refname)', 'refs/remotes/origin/main').trim();
    revision = main ? git('merge-base', 'HEAD', main).trim() : 'HEAD';
  }
  const { $schema: _schema, ...messages } = JSON.parse(git('show', `${revision}:packages/i18n/messages/en.json`));
  return messages;
}

/** Existing catalog keys may leave pending, but cannot be added back in a PR. */
export function pendingGrowth(baseEnglish, basePending, pending) {
  const previous = new Set(basePending);
  return pending.filter((key) => key in baseEnglish && !previous.has(key));
}

function checkBase(base) {
  const previousEnglish = baseCatalog(base);
  const english = catalog('en');
  const keep = keepTerms();
  for (const locale of locales().filter((value) => value !== 'en')) {
    const path = `packages/i18n/untranslated/${locale}.json`;
    const { sameAsEnglish, pending } = exceptions(locale);
    let leftovers;
    try {
      leftovers = untranslatedKeys(english, catalog(locale), keep, previousEnglish, sameAsEnglish);
    } catch (error) {
      throw new Error(`${locale}: ${error.message}`);
    }
    // The first guard PR establishes the baseline; later PRs must shrink it.
    if (git('ls-tree', '--name-only', base, '--', path).trim()) {
      const previous = JSON.parse(git('show', `${base}:${path}`));
      const grown = pendingGrowth(previousEnglish, previous.pending ?? [], pending);
      if (grown.length) throw new Error(`${locale}: pending grew from ${base}: ${grown.join(', ')}`);
    }
    const unlisted = leftovers.filter((key) => !sameAsEnglish.includes(key) && !pending.includes(key));
    if (unlisted.length) throw new Error(`${locale}: untranslated keys not listed against ${base}: ${unlisted.join(', ')}`);
  }
}

/**
 * The next `pending` list from the catalog's leftovers. It may only shrink: a
 * key that isn't pending yet means a string that was translated (or never
 * existed) is now identical to English, which is a regression to fix, not to
 * list. Only a locale without a baseline file yet starts one from scratch.
 */
export function nextPending({ leftovers, sameAsEnglish, pending, exists }) {
  const next = leftovers.filter((key) => !sameAsEnglish.includes(key));
  const grown = exists ? next.filter((key) => !pending.includes(key)) : [];
  if (grown.length)
    throw new Error(`refusing to add ${grown.length} keys to pending (${grown.slice(0, 5).join(', ')}${grown.length > 5 ? ', …' : ''})`);
  return next;
}

/** Every piece of text in a message: the string, or each variant's text. */
export function texts(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap((variant) => Object.values(variant?.match ?? {}).flatMap(texts));
  return [];
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whether nothing translatable is left once placeholders, kept terms, numbers and punctuation go. */
export function onlyKeptTerms(text, keep) {
  let rest = text.replace(/\{[^{}]*\}/g, ' ');
  for (const term of [...keep].sort((a, b) => b.length - a.length)) {
    rest = rest.replace(new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(term)}(?=$|[^\\p{L}\\p{N}])`, 'gu'), '$1 ');
  }
  return !/\p{L}/u.test(rest);
}

/** Text compared for sameness: whitespace runs collapse and the ends trim, so a stray space is no translation. */
const comparable = (value) => texts(value).map((text) => text.replace(/\s+/g, ' ').trim());

const copiesEnglish = (message, english, keep) =>
  typeof message === typeof english &&
  JSON.stringify(comparable(message)) === JSON.stringify(comparable(english)) &&
  !texts(english).every((text) => onlyKeptTerms(text, keep));

/** Current-English leftovers. Old-English copies must be refreshed before they can stay pending. */
export function untranslatedKeys(english, messages, keep, previousEnglish = {}, sameAsEnglish = []) {
  const keys = Object.keys(english).filter((key) => key in messages);
  const stale = keys.filter(
    (key) =>
      key in previousEnglish &&
      JSON.stringify(english[key]) !== JSON.stringify(previousEnglish[key]) &&
      copiesEnglish(messages[key], previousEnglish[key], keep) &&
      !copiesEnglish(messages[key], english[key], keep) &&
      !sameAsEnglish.includes(key),
  );
  if (stale.length)
    throw new Error(
      `Keys still copying the previous English value: ${stale.join(', ')}. ` +
        'Refresh the locale fallback to the current English value and keep the key in pending, translate it, or list it in sameAsEnglish if it legitimately stays the same.',
    );
  return keys.filter((key) => copiesEnglish(messages[key], english[key], keep));
}

const placeholders = (value) => [...new Set(texts(value).flatMap((text) => [...text.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1])))].sort();
/**
 * Structural differences from English: missing or extra keys, and placeholders
 * English doesn't have. Plural shape may differ by language: one without
 * plural forms uses a plain string where English has variants, and Arabic
 * adds forms where English has none. So a variant message (on either side) may
 * use fewer placeholders, since a form may spell its number out, but never
 * others; two plain strings must use exactly the same ones. Variant syntax is
 * validated by the paraglide compile, and catch-all forms by messages.test.ts.
 */
export function parityProblems(english, messages) {
  const problems = [];
  for (const key of Object.keys(english)) {
    if (!(key in messages)) {
      problems.push(`${key}: missing`);
      continue;
    }
    const expected = placeholders(english[key]);
    const actual = placeholders(messages[key]);
    const unknown = actual.filter((name) => !expected.includes(name));
    const bothPlain = typeof english[key] === 'string' && typeof messages[key] === 'string';
    const lost = bothPlain ? expected.filter((name) => !actual.includes(name)) : [];
    if (unknown.length || lost.length) problems.push(`${key}: placeholders ${JSON.stringify(actual)} vs English ${JSON.stringify(expected)}`);
  }
  for (const key of Object.keys(messages)) if (!(key in english)) problems.push(`${key}: not in English`);
  return problems;
}

function main(argv) {
  if (argv[0] === '--check-base') {
    if (argv.length !== 2) throw new Error('usage: untranslated.mjs --check-base <revision>');
    checkBase(argv[1]);
    return;
  }
  const english = catalog('en');
  const previousEnglish = baseCatalog();
  const keep = keepTerms();
  const rewrite = argv.includes('--baseline');
  const chosen = argv.filter((arg) => !arg.startsWith('--'));
  const targets = chosen.length ? chosen : locales().filter((locale) => locale !== 'en');
  for (const locale of targets) {
    const { sameAsEnglish, pending, exists } = exceptions(locale);
    let leftovers;
    try {
      leftovers = untranslatedKeys(english, catalog(locale), keep, previousEnglish, sameAsEnglish);
      if (rewrite) {
        const nextPendingList = nextPending({ leftovers, sameAsEnglish, pending, exists });
        writeFileSync(new URL(`untranslated/${locale}.json`, root), `${JSON.stringify({ sameAsEnglish, pending: nextPendingList }, null, 2)}\n`);
      }
    } catch (error) {
      throw new Error(`${locale}: ${error.message}`);
    }
    const unlisted = leftovers.filter((key) => !sameAsEnglish.includes(key) && !pending.includes(key));
    const untranslated = leftovers.filter((key) => !sameAsEnglish.includes(key)).length;
    console.log(`${locale}: ${untranslated} untranslated (pending ${pending.length}, same as English by design ${sameAsEnglish.length})`);
    if (chosen.length) for (const key of unlisted.slice(0, 50)) console.log(`  not listed: ${key} = ${JSON.stringify(english[key]).slice(0, 100)}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2));
