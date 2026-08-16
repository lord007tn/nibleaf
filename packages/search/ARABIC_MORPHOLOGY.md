# Arabic search morphology

Nibleaf uses the same deterministic Arabic analyzer when a document is inserted
and when a query is executed. It is a conservative light stemmer for
documentation search, not an Arabic root extractor or a general linguistic
lemmatizer.

## Analysis pipeline

Arabic projects have two parallel sets of Orama fields:

1. **Exact fields** contain the original text after spelling normalization.
   Diacritics and tatweel are removed, alef variants are folded to `ا`, and
   alef maqsura is folded to `ي`. These fields retain the existing fuzzy and
   title/heading-weighted ranking behavior.
2. **Morphology fields** apply the same spelling normalization and then produce
   at most one light form per prose token. A token may lose one compound or
   definite-article prefix, one attached pronoun, and one nominal suffix. Common
   feminine plural/dual forms are converted to their safe singular form.

The light rules cover common combinations of conjunctions and prepositions
with the definite article (`والـ`, `فالـ`, `بالـ`, `كالـ`, `للـ`), long bare
conjunction forms, attached pronouns such as `هم`, `ها`, `نا`, `كما`, and sound
plural/dual endings such as `ون`, `ين`, `ان`, `ات`, `تان`, and `تين`. A small,
reviewed documentation vocabulary handles forms whose singular cannot be
selected safely from the suffix alone, such as `إعدادات`, `صلاحيات`, `واجهات`,
and `مكتبات`.

Search runs the existing exact/fuzzy channel and one morphology channel. The
morphology channel reads at most 64 candidates; the direct channel continues to
honor larger caller-requested limits. Exact whole-token phrases receive an
explicit field-aware signal (title, then heading, description, and content),
and every direct exact/fuzzy result ranks ahead of morphology-only recall.
Morphology field boosts and returned morphology-only scores are deliberately
lower. This preserves existing exact results while allowing `مستخدم` to find
`للمستخدمين` and a one-edit typo such as `مستخدك` to use the same bounded fuzzy
tolerance against the light form.

## Safety rules

- Tokens shorter than five Arabic letters are not stemmed.
- Ta marbuta is never folded to ha and terminal `ة` is not blindly removed.
- Mixed Arabic/Latin terms, identifiers containing digits or connector
  punctuation, and Markdown inline/fenced code are omitted from morphology
  fields. They remain searchable through the exact fields.
- A protected ambiguity list covers common proper names, places, function
  words, and broken plurals that resemble sound suffixes.
- Only pure Arabic prose tokens are analyzed. Latin search behavior and all
  non-Arabic project tokenizers are unchanged.
- Expansion is constant: one deterministic light form per token, no root fanout
  or synonym graph.

## Tradeoffs and maintenance

Arabic has no capitalization signal for proper nouns, and light affix rules
cannot resolve every lexical ambiguity. The analyzer therefore favors precision
and intentionally misses some dialectal forms, broken plurals, one-letter
pronouns, verb conjugations, and uncommon clitic combinations. Add a reviewed
irregular form or protection only with both positive and negative corpus cases.

The table-driven corpus in `src/arabic.test.ts` is the compatibility contract.
It includes ranking, mixed-language, code, typo-plus-morphology, ambiguity, and
timed regression cases. `pnpm --filter @nibleaf/search bench` runs repeatable
throughput benchmarks for the analyzer and a 500-document index.
