import { components, type DefaultTokenizerConfig } from '@orama/orama';

const oramaTokenizer = components.tokenizer;

type DefaultTokenizer = ReturnType<typeof oramaTokenizer.createTokenizer>;
export type SearchTokenizerLanguage = NonNullable<DefaultTokenizerConfig['language']>;

/**
 * The retrieval tokenizer's configuration and its token normalization, shared by
 * the Orama index and the reader relevance gate. Orama folds accents when it
 * indexes and queries (`Café` and `cafe` are the same token), so relevance must
 * fold the same way or it rejects candidates retrieval correctly found.
 */

/** Orama stemming stays off. Arabic uses the deterministic light analyzer in
 *  this package; other languages keep Orama's own tokenization. */
export const oramaTokenizerConfig = (language: SearchTokenizerLanguage = 'english'): DefaultTokenizerConfig => ({
  language,
  stemming: false,
});

// One normalizer per language (a handful at most). Always called without
// Orama's per-token cache, so it never grows with indexed or queried text.
const normalizers = new Map<string, DefaultTokenizer>();

/**
 * Applies Orama's token normalization (lowercase, then its accent folding) to
 * a whole string. The folding maps each UTF-16 unit to exactly one unit, so
 * offsets in the result match `value.toLowerCase()`, and snippets can be cut
 * from the original text.
 *
 * Orama builds its result with `String.fromCharCode(...units)`, which overflows
 * the call stack on page-sized input, so long text is folded in bounded slices.
 * The folding is per unit, so slicing never changes the result.
 */
const FOLD_SLICE = 4096;

export const foldSearchText = (value: string, language: SearchTokenizerLanguage = 'english'): string => {
  let normalizer = normalizers.get(language);
  if (!normalizer) {
    normalizer = oramaTokenizer.createTokenizer(oramaTokenizerConfig(language));
    normalizers.set(language, normalizer);
  }
  const lower = value.toLowerCase();
  if (lower.length <= FOLD_SLICE) return normalizer.normalizeToken('', lower, false);
  let folded = '';
  for (let start = 0; start < lower.length; start += FOLD_SLICE) {
    folded += normalizer.normalizeToken('', lower.slice(start, start + FOLD_SLICE), false);
  }
  return folded;
};
