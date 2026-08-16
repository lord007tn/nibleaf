/*
 * The light stemming core in this file is adapted from Apache Lucene's
 * ArabicStemmer (Apache-2.0). See the repository NOTICE and:
 * https://github.com/apache/lucene/blob/main/lucene/analysis/common/src/java/org/apache/lucene/analysis/ar/ArabicStemmer.java
 */

const ARABIC_DIACRITICS = /[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]/g;
const ARABIC_ALEF_VARIANTS = /[\u0622\u0623\u0625\u0671]/g;
const PURE_ARABIC_WORD = /^[\u0621-\u063a\u0641-\u064a]+$/u;
const CONTAINS_ARABIC = /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/u;
const SEARCH_TOKEN = /[\p{L}\p{M}\p{N}_+.#@:/\\-]+/gu;

// Lucene Light10 affixes. These grammatical categories replace the former
// application-specific singular/plural dictionary.
const LUCENE_PREFIXES = ['وال', 'بال', 'كال', 'فال', 'ال', 'لل'] as const;
const LUCENE_SUFFIXES = ['ها', 'ان', 'ات', 'ون', 'ين', 'يه', 'ية', 'ه', 'ة', 'ي'] as const;

// Light10 omits several productive attached pronouns. Removing one before the
// standard suffix pass covers documentation phrases such as إعداداتهم without
// attempting root extraction.
const ATTACHED_PRONOUNS = ['كما', 'هما', 'كم', 'كن', 'نا', 'هم', 'هن'] as const;
const FEMININE_DUALS = ['تان', 'تين'] as const;

// Arabic has no casing signal for named entities. Lucene's analyzer exposes a
// stem-exclusion set for the same reason. Keep this list limited to high-risk
// words where the unmarked form is itself a common word (الرياض -> رياض) or a
// suffix-looking broken plural. It is not a morphology dictionary.
const STEM_EXCLUSIONS = new Set([
  'الله',
  'رياض',
  'الرياض',
  'عمان',
  'محمد',
  'مريم',
  'احمد',
  'ابراهيم',
  'يوسف',
  'قوانين',
  'عناوين',
  'سكاكين',
  'شياطين',
]);

/** Conservative Arabic spelling normalization shared by exact and
 * morphological indexing/query paths. Ta marbuta deliberately remains
 * distinct from ha in the exact channel. */
export const normalizeArabicSearchText = (value: string): string =>
  value
    .replace(ARABIC_DIACRITICS, '')
    .replace(/\u0640/g, '')
    .replace(ARABIC_ALEF_VARIANTS, '\u0627')
    .replace(/\u0649/g, '\u064a');

function stripPrefix(word: string): string {
  for (const prefix of LUCENE_PREFIXES) {
    if (word.startsWith(prefix) && word.length >= prefix.length + 2) {
      const remainder = word.slice(prefix.length);
      // Preserve a definite article when it distinguishes a protected name,
      // but still detach an outer conjunction: والرياض -> الرياض.
      if (STEM_EXCLUSIONS.has(remainder)) {
        return word.startsWith('و') && STEM_EXCLUSIONS.has(word.slice(1)) ? word.slice(1) : word;
      }
      return remainder;
    }
  }

  // Bare one-letter clitics are much more ambiguous than compounds with ال.
  // Limit them to long م-prefixed documentation nouns; this handles forms such
  // as ومستخدمون and بمستنداتهم without corrupting وثائق or واجهات.
  if (/^[وفبكل]م/u.test(word) && word.length >= 7) {
    return word.slice(1);
  }
  return word;
}

function stripOneAttachedPronoun(word: string): string {
  for (const suffix of ATTACHED_PRONOUNS) {
    if (word.endsWith(suffix) && word.length >= suffix.length + 3) {
      return word.slice(0, -suffix.length);
    }
  }
  return word;
}

function normalizeFeminineDual(word: string): string {
  for (const suffix of FEMININE_DUALS) {
    if (word.endsWith(suffix) && word.length >= suffix.length + 3) {
      return `${word.slice(0, -suffix.length)}ة`;
    }
  }
  return word;
}

/** Apply the Light10 suffix categories with one precision adjustment. Lucene's
 * in-place ordered pass can remove both ـات and the resulting final ه; because
 * our exact normalizer intentionally preserves ة, we stop after a sound-plural
 * removal except for the productive ـيات -> ـي -> base sequence. */
function stripLuceneSuffixes(word: string): string {
  if (word.endsWith('ات') && word.length >= 4) {
    const stem = word.slice(0, -2);
    return stem.endsWith('ي') && stem.length >= 4 ? stem.slice(0, -1) : stem;
  }
  for (const suffix of LUCENE_SUFFIXES) {
    if (word.endsWith(suffix) && word.length >= suffix.length + 2) {
      return word.slice(0, -suffix.length);
    }
  }
  return word;
}

/**
 * Return one deterministic, conservative Arabic light stem. This is based on
 * Apache Lucene Light10, extended only for attached pronouns and feminine
 * duals. It never extracts triliteral roots. Exact normalized tokens are kept
 * in separate index fields, so this form can only add a recall signal.
 */
export function lightStemArabicToken(token: string): string {
  const normalized = normalizeArabicSearchText(token);
  if (normalized.length < 4 || !PURE_ARABIC_WORD.test(normalized) || STEM_EXCLUSIONS.has(normalized)) {
    return normalized;
  }

  const withoutPrefix = stripPrefix(normalized);
  if (STEM_EXCLUSIONS.has(withoutPrefix)) {
    return withoutPrefix;
  }
  const withoutPronoun = stripOneAttachedPronoun(withoutPrefix);
  const restoredFeminine =
    withoutPronoun !== withoutPrefix && withoutPronoun.endsWith('ت') && !withoutPronoun.endsWith('ات')
      ? `${withoutPronoun.slice(0, -1)}ة`
      : withoutPronoun;
  const withoutDual = normalizeFeminineDual(restoredFeminine);
  const stem = stripLuceneSuffixes(withoutDual);
  return stem.length >= 2 ? stem : normalized;
}

interface DelimiterRun {
  start: number;
  end: number;
  length: number;
  nextSame: number;
}

function maskInlineCodeLine(line: string): string {
  const runs: DelimiterRun[] = [];
  const nextByLength = new Map<number, number>();
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] !== '`') continue;
    let end = index + 1;
    while (line[end] === '`') end += 1;
    runs.push({ start: index, end, length: end - index, nextSame: -1 });
    index = end - 1;
  }
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    const run = runs[index];
    if (!run) continue;
    run.nextSame = nextByLength.get(run.length) ?? -1;
    nextByLength.set(run.length, index);
  }

  if (runs.length < 2) return line;
  const masked = [...line];
  for (let index = 0; index < runs.length; index += 1) {
    const opening = runs[index];
    if (!opening || opening.nextSame === -1) continue;
    const closing = runs[opening.nextSame];
    if (!closing) continue;
    masked.fill(' ', opening.start, closing.end);
    index = opening.nextSame;
  }
  return masked.join('');
}

function fenceRunAtLineStart(line: string): { marker: string; length: number } | undefined {
  let index = 0;
  while (index < 4 && line[index] === ' ') index += 1;
  const marker = line[index];
  if (marker !== '`' && marker !== '~') return undefined;
  let end = index;
  while (line[end] === marker) end += 1;
  const length = end - index;
  return length >= 3 ? { marker, length } : undefined;
}

/** Mask CommonMark inline/fenced code with spaces while preserving line breaks
 * and offsets. Delimiter runs are indexed once, keeping analysis linear even
 * for malformed documentation with many unmatched backticks. */
function maskMarkdownCode(value: string): string {
  let output = '';
  let index = 0;
  let fenceMarker = '';
  let fenceLength = 0;
  while (index < value.length) {
    const newline = value.indexOf('\n', index);
    const end = newline === -1 ? value.length : newline;
    const line = value.slice(index, end);
    const fence = fenceRunAtLineStart(line);
    const opensFence = !fenceMarker && fence !== undefined;
    const closesFence = fenceMarker === fence?.marker && (fence?.length ?? 0) >= fenceLength;
    if (opensFence || fenceMarker) {
      output += ' '.repeat(line.length);
      if (opensFence && fence) {
        fenceMarker = fence.marker;
        fenceLength = fence.length;
      } else if (closesFence) {
        fenceMarker = '';
        fenceLength = 0;
      }
    } else {
      output += maskInlineCodeLine(line);
    }
    if (newline !== -1) output += '\n';
    index = newline === -1 ? value.length : newline + 1;
  }
  return output;
}

function analyzeProse(value: string): string {
  return value.replace(SEARCH_TOKEN, (token) => {
    if (PURE_ARABIC_WORD.test(token)) {
      return lightStemArabicToken(token);
    }
    // Orama can split scripts inside a token. Omit mixed Arabic/Latin,
    // versioned, path-like, and identifier-shaped tokens from the morphology
    // field so their Arabic fragment is never stemmed accidentally.
    return CONTAINS_ARABIC.test(token) ? ' ' : token;
  });
}

/** Apply the exact same bounded analysis to indexed prose and queries. Code and
 * mixed-script identifiers are omitted only from the morphology channel. */
export function normalizeArabicMorphologyText(value: string): string {
  return analyzeProse(maskMarkdownCode(normalizeArabicSearchText(value)));
}
