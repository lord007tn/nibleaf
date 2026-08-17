# Arabic search morphology

Nibleaf uses one deterministic Arabic analyzer for document insertion and
queries. It is based on Apache Lucene's TREC-tested Arabic Light10 stemmer, not
a root extractor or a general linguistic lemmatizer. The implementation keeps
Orama as the search engine and changes analysis and ranking around it; no NLP
service, model download, database migration, or per-site configuration is
required.

## Analysis pipeline

Arabic projects index two parallel field groups:

1. **Normalized fields** preserve every token after spelling normalization.
   Diacritics and tatweel are removed, alef variants are folded to `ا`, and
   alef maqsura is folded to `ي`. These fields retain exact phrases, technical
   spelling, prefix completion, and fuzzy matching.
2. **Morphology fields** apply the same spelling normalization followed by the
   Light10 affix categories. The standard definite article, conjunction,
   preposition, sound plural, dual, feminine, and possessive suffix rules are
   extended conservatively for common attached pronouns and feminine duals.

The analyzer emits one morphology form per prose token, so expansion is linear
and bounded. Original normalized tokens stay in the first field group; stemming
can add recall but cannot erase the exact ranking signal.

The implementation is adapted from [Apache Lucene ArabicStemmer](https://github.com/apache/lucene/blob/main/lucene/analysis/common/src/java/org/apache/lucene/analysis/ar/ArabicStemmer.java),
licensed Apache-2.0. Lucene documents this as removal of attached articles,
conjunctions, prepositions, and common suffixes. Nibleaf intentionally does not
use Orama's Arabic Snowball stemmer: corpus evaluation found aggressive outputs
such as `سيارات -> يارا` and `وثائق -> ثايق`, which are unsuitable for
documentation search.

## Ranking lanes

Arabic searches use explicit, independently weighted lanes:

1. An exact normalized phrase signal, field-weighted title, heading,
   description, then content.
2. A normalized lexical/prefix lane with fuzzy matching disabled.
3. A lower-weight Light10 morphology lane with fuzzy matching disabled.
4. Low-weight lexical and morphology fuzzy lanes, created only when the
   adaptive query tolerance is non-zero.

Results are combined with weighted reciprocal-rank fusion. Exact phrase signals
sort first; fused lane scores break the remaining ties; document id provides a
stable final tie-break. This prevents incomparable raw scores from separate
fields from destabilizing the order. Morphology and fuzzy lanes each inspect at
most 64 candidates. Short query terms still receive zero typo tolerance, and
the existing adaptive maximum remains unchanged.

## Safety rules

- Tokens shorter than four Arabic letters are not stemmed.
- Mixed Arabic/Latin terms, identifiers containing digits or connector
  punctuation, and path-like tokens are omitted from morphology fields. Exact
  fields retain them.
- A stateful CommonMark scanner masks inline code and fenced code, including
  variable-length fences, before morphology analysis. Unmatched backticks do
  not hide the rest of a document.
- Bare one-letter clitics are detached only from long `م`-prefixed words. This
  supports common documentation nouns without corrupting lexical initials such
  as `و` in `وثائق` and `واجهات`.
- A small Lucene-style stem-exclusion set protects ambiguous proper nouns and
  suffix-looking broken plurals. It replaces the previous documentation-word
  singular dictionary; it is not used to manufacture lemmas.
- Ta marbuta remains distinct from ha in normalized exact fields.
- The analyzer never performs triliteral-root extraction.

## Quality and performance gates

`src/arabic.test.ts` is a table-driven compatibility corpus covering affixes,
attached pronouns, duals, proper nouns, ambiguity, code, mixed-language terms,
typo plus morphology, ranking, snippets, deterministic ordering, and timed
regression ceilings.

`src/arabic.relevance.test.ts` is a judged corpus with positive and negative
queries. CI requires mean Recall@5 ≥ 0.95, MRR ≥ 0.95, and nDCG@5 ≥ 0.90.
`pnpm --filter @nibleaf/search bench` measures analyzer throughput and repeated
queries against a 500-document Arabic index.

## Known tradeoffs

Arabic has no capitalization signal, so a lightweight analyzer cannot identify
every previously unseen proper noun. The exclusion set covers demonstrated
high-risk collisions; exact matches still dominate for all other names. Broken
plurals, dialectal forms, and uncommon verb conjugations may remain unmatched
unless their surface spelling or prefix is present. Full contextual
lemmatization would require a sizable dictionary/model and substantially more
runtime and deployment complexity; it should only replace this analyzer after
evaluation against the same judged relevance corpus.
