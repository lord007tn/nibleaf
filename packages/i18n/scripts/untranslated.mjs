#!/usr/bin/env node
// Untranslated strings and placeholder parity for the message catalogs.
//
//   pnpm --filter @nibleaf/i18n run untranslated            every locale's pending count
//   pnpm --filter @nibleaf/i18n run untranslated de         de's pending keys and leftovers
//   pnpm --filter @nibleaf/i18n run untranslated -- --baseline de
//                                                           rewrite untranslated/de.json's pending list
//                                                           from the catalog (only ever to shrink it)
//
// A string is untranslated when its value is exactly the English one, unless
// nothing translatable is left once {placeholders}, glossary doNotTranslate
// terms, numbers and punctuation are taken out ("GitHub", "{count} MB").
// untranslated/<locale>.json lists the exceptions: `sameAsEnglish` (identical
// on purpose, e.g. a loanword the locale uses as is) and `pending` (not
// translated yet; it only shrinks). src/untranslated.test.ts enforces both.
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
    return { sameAsEnglish, pending };
  } catch {
    return { sameAsEnglish: [], pending: [] };
  }
};

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

/** Keys whose value is exactly the English one and still has something to translate. */
export function untranslatedKeys(english, messages, keep) {
  return Object.keys(english).filter(
    (key) =>
      key in messages &&
      JSON.stringify(messages[key]) === JSON.stringify(english[key]) &&
      !texts(english[key]).every((text) => onlyKeptTerms(text, keep)),
  );
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
  const english = catalog('en');
  const keep = keepTerms();
  const rewrite = argv.includes('--baseline');
  const chosen = argv.filter((arg) => !arg.startsWith('--'));
  const targets = chosen.length ? chosen : locales().filter((locale) => locale !== 'en');
  for (const locale of targets) {
    const leftovers = untranslatedKeys(english, catalog(locale), keep);
    const { sameAsEnglish, pending } = exceptions(locale);
    if (rewrite) {
      const nextPending = leftovers.filter((key) => !sameAsEnglish.includes(key));
      const grown = nextPending.filter((key) => !pending.includes(key));
      if (pending.length && grown.length)
        throw new Error(`${locale}: refusing to add ${grown.length} keys to pending (${grown.slice(0, 5).join(', ')}…)`);
      writeFileSync(new URL(`untranslated/${locale}.json`, root), `${JSON.stringify({ sameAsEnglish, pending: nextPending }, null, 2)}\n`);
    }
    const unlisted = leftovers.filter((key) => !sameAsEnglish.includes(key) && !pending.includes(key));
    const untranslated = leftovers.filter((key) => !sameAsEnglish.includes(key)).length;
    console.log(`${locale}: ${untranslated} untranslated (pending ${pending.length}, same as English by design ${sameAsEnglish.length})`);
    if (chosen.length) for (const key of unlisted.slice(0, 50)) console.log(`  not listed: ${key} = ${JSON.stringify(english[key]).slice(0, 100)}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2));
