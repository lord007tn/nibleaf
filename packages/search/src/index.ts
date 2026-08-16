import { create, insertMultiple, type Orama, search } from '@orama/orama';
import { keys } from './keys';

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

const ARABIC_DIACRITICS = /[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]/g;
const ARABIC_ALEF_VARIANTS = /[\u0622\u0623\u0625\u0671]/g;

/** Conservative Arabic spelling normalization used on both indexed text and
 * queries. It removes vocalization/tatweel and folds common alef/ya variants,
 * but deliberately does not stem words or conflate ta marbuta with ha. */
export const normalizeArabicSearchText = (value: string): string =>
  value
    .replace(ARABIC_DIACRITICS, '')
    .replace(/\u0640/g, '')
    .replace(ARABIC_ALEF_VARIANTS, '\u0627')
    .replace(/\u0649/g, '\u064a');

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
} as const;

export type DocIndex = Orama<typeof docSchema>;

const indexLanguages = new WeakMap<object, OramaLanguage>();
const indexDocuments = new WeakMap<object, Map<string, SearchDoc>>();

/** Build an in-memory Orama index from a set of documentation pages, tokenized
 *  for the given language (defaults to English). */
export const createDocIndex = async (docs: SearchDoc[], language: OramaLanguage = 'english'): Promise<DocIndex> => {
  const db = (await create({
    schema: docSchema,
    components: {
      // Stemming would need the optional @orama/stemmers package; the
      // language-specific word splitter alone is what makes Arabic (and other
      // non-English scripts) searchable, so we keep stemming off.
      tokenizer: { language, stemming: false },
    },
  })) as DocIndex;
  indexLanguages.set(db, language);
  indexDocuments.set(db, new Map(docs.map((doc) => [doc.id, doc])));
  const searchable = (value: string) => (language === 'arabic' ? normalizeArabicSearchText(value) : value);
  if (docs.length > 0) {
    await insertMultiple(
      db,
      docs.map((doc) => ({
        id: doc.id,
        searchTitle: searchable(doc.title),
        searchDescription: searchable(doc.description),
        searchHeadings: searchable(doc.headings),
        searchContent: searchable(doc.content),
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
  const query = indexLanguages.get(db) === 'arabic' ? normalizeArabicSearchText(rawQuery) : rawQuery;
  if (!query) {
    return [];
  }
  const tolerance = fuzzyToleranceForQuery(query, options.tolerance ?? keys().SEARCH_FUZZY_TOLERANCE);
  const results = await search(db, {
    term: query,
    properties: ['searchTitle', 'searchHeadings', 'searchDescription', 'searchContent'],
    tolerance,
    boost: { searchTitle: 4, searchHeadings: 2, searchDescription: 1.5 },
    limit: options.limit ?? 12,
  });

  return results.hits.map((hit) => {
    const indexed = hit.document as unknown as { id: string };
    const doc = indexDocuments.get(db)?.get(String(indexed.id));
    if (!doc) {
      throw new Error(`Search result ${indexed.id} is missing its source document.`);
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
