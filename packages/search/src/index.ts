import { create, insertMultiple, type Orama, search } from '@orama/orama';
import { lightStemArabicToken, normalizeArabicMorphologyText, normalizeArabicSearchText } from './arabic';
import { keys } from './keys';

export { lightStemArabicToken, normalizeArabicMorphologyText, normalizeArabicSearchText } from './arabic';

// Orama ships a built-in tokenizer (word splitter + optional stemmer) per
// language. We map a project language CODE (BCP-47 primary subtag) to the Orama
// language so non-Latin scripts — Arabic above all — are tokenized correctly.
// Without this, Orama defaults to English, whose splitter drops every Arabic
// codepoint, so Arabic queries silently return ZERO hits.
export type OramaLanguage =
  | 'english'
  | 'arabic'
  | 'french'
  | 'german'
  | 'spanish'
  | 'italian'
  | 'portuguese'
  | 'dutch'
  | 'russian'
  | 'swedish'
  | 'norwegian'
  | 'danish'
  | 'finnish'
  | 'turkish'
  | 'greek';

const CODE_TO_ORAMA: Record<string, OramaLanguage> = {
  ar: 'arabic',
  en: 'english',
  fr: 'french',
  de: 'german',
  es: 'spanish',
  it: 'italian',
  pt: 'portuguese',
  nl: 'dutch',
  ru: 'russian',
  sv: 'swedish',
  no: 'norwegian',
  da: 'danish',
  fi: 'finnish',
  tr: 'turkish',
  el: 'greek',
};

/** Map a language code (e.g. 'ar', 'ar-SA', 'en-US') to an Orama tokenizer
 *  language, defaulting to English for codes Orama doesn't tokenize. */
export const oramaLanguageForCode = (code?: string): OramaLanguage => {
  if (!code) {
    return 'english';
  }
  const primary = code.toLowerCase().split('-')[0] ?? '';
  return CODE_TO_ORAMA[primary] ?? 'english';
};

/** A single searchable documentation page. */
export interface SearchDoc {
  id: string;
  title: string;
  path: string;
  description: string;
  headings: string;
  content: string;
  icon?: string;
}

export interface SearchHit {
  id: string;
  title: string;
  path: string;
  description: string;
  icon?: string;
  snippet: string;
  score: number;
}

const docSchema = {
  id: 'string',
  searchTitle: 'string',
  searchDescription: 'string',
  searchHeadings: 'string',
  searchContent: 'string',
  morphologyTitle: 'string',
  morphologyDescription: 'string',
  morphologyHeadings: 'string',
  morphologyContent: 'string',
} as const;

export type DocIndex = Orama<typeof docSchema>;

const indexLanguages = new WeakMap<object, OramaLanguage>();
const indexDocuments = new WeakMap<object, Map<string, SearchDoc>>();
const RANK_TOKEN = /[\p{L}\p{M}\p{N}_+.#@:/\\-]+/gu;

function containsExactTokenSequence(value: string, query: string): boolean {
  const valueTokens = value.toLowerCase().match(RANK_TOKEN) ?? [];
  const queryTokens = query.toLowerCase().match(RANK_TOKEN) ?? [];
  if (queryTokens.length === 0 || queryTokens.length > valueTokens.length) {
    return false;
  }
  return valueTokens.some((_, start) => queryTokens.every((token, offset) => valueTokens[start + offset] === token));
}

function exactArabicSignal(doc: SearchDoc, query: string): number {
  if (containsExactTokenSequence(normalizeArabicSearchText(doc.title), query)) return 4;
  if (containsExactTokenSequence(normalizeArabicSearchText(doc.headings), query)) return 3;
  if (containsExactTokenSequence(normalizeArabicSearchText(doc.description), query)) return 2;
  if (containsExactTokenSequence(normalizeArabicSearchText(doc.content), query)) return 1;
  return 0;
}

/** Build an in-memory Orama index from a set of documentation pages, tokenized
 *  for the given language (defaults to English). */
export const createDocIndex = async (docs: SearchDoc[], language: OramaLanguage = 'english'): Promise<DocIndex> => {
  const db = (await create({
    schema: docSchema,
    components: {
      // Orama stemming stays off. Arabic uses the deterministic light analyzer
      // in this package; other languages retain their existing tokenization.
      tokenizer: { language, stemming: false },
    },
  })) as DocIndex;
  indexLanguages.set(db, language);
  indexDocuments.set(db, new Map(docs.map((doc) => [doc.id, doc])));
  const searchable = (value: string) => (language === 'arabic' ? normalizeArabicSearchText(value) : value);
  const morphological = (value: string) => (language === 'arabic' ? normalizeArabicMorphologyText(value) : '');
  if (docs.length > 0) {
    await insertMultiple(
      db,
      docs.map((doc) => ({
        id: doc.id,
        searchTitle: searchable(doc.title),
        searchDescription: searchable(doc.description),
        searchHeadings: searchable(doc.headings),
        searchContent: searchable(doc.content),
        morphologyTitle: morphological(doc.title),
        morphologyDescription: morphological(doc.description),
        morphologyHeadings: morphological(doc.headings),
        morphologyContent: morphological(doc.content),
      })),
    );
  }
  return db;
};

export interface SearchOptions {
  limit?: number;
  /** Maximum Levenshtein distance. The effective distance is reduced for short
   * tokens to avoid noisy matches such as API -> app. */
  tolerance?: number;
}

/** Orama's tolerance is a Levenshtein edit distance. Long words can absorb two
 * typing mistakes without becoming ambiguous; short technical terms cannot. */
export const fuzzyToleranceForQuery = (query: string, maximum: number): number => {
  const longestToken = query
    .trim()
    .split(/\s+/)
    .reduce((longest, token) => Math.max(longest, token.length), 0);
  if (longestToken <= 3) {
    return 0;
  }
  if (longestToken <= 7) {
    return Math.min(maximum, 1);
  }
  return Math.min(maximum, 2);
};

/** Full-text + fuzzy search over a doc index, title/heading-boosted, with snippets. */
export const searchDocs = async (db: DocIndex, term: string, options: SearchOptions = {}): Promise<SearchHit[]> => {
  const rawQuery = term.trim();
  const arabic = indexLanguages.get(db) === 'arabic';
  const query = arabic ? normalizeArabicSearchText(rawQuery) : rawQuery;
  if (!query) {
    return [];
  }
  const tolerance = fuzzyToleranceForQuery(query, options.tolerance ?? keys().SEARCH_FUZZY_TOLERANCE);
  const limit = options.limit ?? 12;
  const morphologyCandidateLimit = Math.min(Math.max(limit * 2, 24), 64);
  const directCandidateLimit = Math.max(limit, morphologyCandidateLimit);
  const results = await search(db, {
    term: query,
    properties: ['searchTitle', 'searchHeadings', 'searchDescription', 'searchContent'],
    tolerance,
    boost: { searchTitle: 4, searchHeadings: 2, searchDescription: 1.5 },
    limit: directCandidateLimit,
  });

  // Morphology is a second, bounded recall channel. Keeping it out of the
  // original fields preserves their ranking channel and keeps morphology-only
  // recall below direct matches.
  const morphologyQuery = arabic ? normalizeArabicMorphologyText(rawQuery).trim() : '';
  const morphologyResults =
    arabic && morphologyQuery
      ? await search(db, {
          term: morphologyQuery,
          properties: ['morphologyTitle', 'morphologyHeadings', 'morphologyDescription', 'morphologyContent'],
          tolerance,
          boost: { morphologyTitle: 1.5, morphologyHeadings: 0.8, morphologyDescription: 0.5, morphologyContent: 0.35 },
          limit: morphologyCandidateLimit,
        })
      : undefined;

  const maximumDirectScore = results.hits.reduce((maximum, hit) => Math.max(maximum, hit.score), 0);
  type RankedHit = { id: string; score: number; direct: boolean; exactSignal: number };
  const ranked = new Map<string, RankedHit>();
  for (const hit of results.hits) {
    const indexed = hit.document as unknown as { id: string };
    const id = String(indexed.id);
    const source = indexDocuments.get(db)?.get(id);
    const exactSignal = arabic && source ? exactArabicSignal(source, query) : 0;
    ranked.set(id, { id, score: hit.score + exactSignal * (maximumDirectScore + 1), direct: true, exactSignal });
  }
  for (const hit of morphologyResults?.hits ?? []) {
    const indexed = hit.document as unknown as { id: string };
    const id = String(indexed.id);
    if (!ranked.has(id)) {
      ranked.set(id, { id, score: hit.score * 0.15, direct: false, exactSignal: 0 });
    }
  }

  const merged = [...ranked.values()]
    .sort((left, right) => right.exactSignal - left.exactSignal || Number(right.direct) - Number(left.direct) || right.score - left.score)
    .slice(0, limit);

  return merged.map((hit) => {
    const doc = indexDocuments.get(db)?.get(hit.id);
    if (!doc) {
      throw new Error(`Search result ${hit.id} is missing its source document.`);
    }
    return {
      id: String(doc.id),
      title: doc.title,
      path: doc.path,
      description: doc.description,
      icon: doc.icon || undefined,
      snippet: makeSnippet(doc.content, rawQuery, indexLanguages.get(db) === 'arabic'),
      score: hit.score,
    };
  });
};

const SNIPPET_RADIUS = 90;
const ARABIC_SNIPPET_WORD = /[\u0621-\u063a\u0640-\u065f\u0670\u0671\u06d6-\u06ed]+/gu;

/** Strip common Markdown/MDX syntax so a search snippet reads as clean prose
 *  instead of showing literal `# heading`, `**bold**`, fenced code, etc. */
export function stripMarkdown(src: string): string {
  return src
    .replace(/```[\s\S]*?```/g, ' ') // fenced code blocks
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    .replace(/`([^`]+)`/g, '$1') // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links → text
    .replace(/<\/?[A-Za-z][^>]*>/g, ' ') // html / MDX component tags
    .replace(/\[!\w+\]/g, ' ') // admonition markers ([!NOTE])
    .replace(/^\s{0,3}#{1,6}\s+/gm, '') // ATX headings
    .replace(/^\s{0,3}>\s?/gm, '') // blockquote markers
    .replace(/^\s*([-*+]|\d+\.)\s+/gm, '') // list bullets / ordered markers
    .replace(/^\s*([-=*_]\s*){3,}$/gm, ' ') // hr / setext underlines
    .replace(/[*~]{1,3}/g, '') // emphasis markers (preserve underscores in code-like identifiers)
    .replace(/\|/g, ' ') // table pipes
    .replace(/\s+/g, ' ')
    .trim();
}

/** Build a short snippet centered on the first occurrence of the query. */
function makeSnippet(content: string, query: string, arabic = false): string {
  const haystack = stripMarkdown(content);
  const firstTerm = query.toLowerCase().split(' ')[0] ?? '';
  if (arabic) {
    const normalized = normalizeArabicWithOffsets(haystack.toLowerCase());
    const normalizedTerm = normalizeArabicSearchText(firstTerm);
    const normalizedIndex = normalized.value.indexOf(normalizedTerm);
    if (normalizedIndex !== -1) {
      const normalizedStart = Math.max(0, normalizedIndex - SNIPPET_RADIUS);
      const normalizedEnd = Math.min(normalized.value.length, normalizedIndex + SNIPPET_RADIUS);
      const start = normalized.offsets[normalizedStart] ?? 0;
      const end = normalized.offsets[normalizedEnd] ?? haystack.length;
      return `${start > 0 ? '…' : ''}${haystack.slice(start, end)}${end < haystack.length ? '…' : ''}`;
    }

    const queryWord = firstTerm.match(ARABIC_SNIPPET_WORD)?.[0];
    if (queryWord) {
      const queryStem = lightStemArabicToken(queryWord);
      for (const match of haystack.matchAll(ARABIC_SNIPPET_WORD)) {
        if (lightStemArabicToken(match[0]) !== queryStem) continue;
        const index = match.index;
        const start = Math.max(0, index - SNIPPET_RADIUS);
        const end = Math.min(haystack.length, index + SNIPPET_RADIUS);
        return `${start > 0 ? '…' : ''}${haystack.slice(start, end)}${end < haystack.length ? '…' : ''}`;
      }
    }
  }
  const idx = haystack.toLowerCase().indexOf(firstTerm);
  if (idx === -1) {
    return haystack.slice(0, SNIPPET_RADIUS * 2);
  }
  const start = Math.max(0, idx - SNIPPET_RADIUS);
  const end = Math.min(haystack.length, idx + SNIPPET_RADIUS);
  return `${start > 0 ? '…' : ''}${haystack.slice(start, end)}${end < haystack.length ? '…' : ''}`;
}

/** Normalize Arabic while retaining each normalized character's source offset,
 * so snippets can be centered without discarding the reader's original text. */
function normalizeArabicWithOffsets(value: string): { value: string; offsets: number[] } {
  let normalized = '';
  const offsets: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const folded = normalizeArabicSearchText(value[index] ?? '');
    for (const char of folded) {
      normalized += char;
      offsets.push(index);
    }
  }
  offsets.push(value.length);
  return { value: normalized, offsets };
}
