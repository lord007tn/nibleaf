import { createHash } from 'node:crypto';
import { lightStemArabicToken, normalizeArabicSearchText } from './arabic';
import type { SearchHit } from './index';

const TOKEN = /[\p{L}\p{M}\p{N}_+.#@:/\\-]+/gu;
const ARABIC = /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/u;
const CODE_TOKEN = /[_+.#@:/\\-]|\d/u;
export type SearchTokenAdapter = (token: string) => string[];

const plainText = (value: string): string =>
  value
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[>*_~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export interface SearchScope {
  projectId: string;
  deploymentId: string;
  versionSlug: string;
  language: string;
  visibility: 'public' | 'private';
  /** null means the authorized viewer may read every page. */
  allowedPageIds: ReadonlySet<string> | null;
}

export interface SearchChunkSource {
  id: string;
  title: string;
  path: string;
  description: string;
  headings: string[];
  content: string;
  icon?: string;
  language: string;
  visible: boolean;
}

export interface SearchChunk {
  id: string;
  pageId: string;
  ordinal: number;
  title: string;
  path: string;
  description: string;
  heading: string;
  headingPath: string[];
  content: string;
  contentHash: string;
  language: string;
  direction: 'ltr' | 'rtl';
  visible: boolean;
  icon?: string;
}

export interface SparseVector {
  indices: number[];
  values: number[];
}

export interface HybridChunkHit {
  chunk: SearchChunk;
  score: number;
}

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/** Qdrant point ids accept UUIDs. Derive one from immutable scope + content so
 * retries upsert the same point while a changed chunk receives a new identity. */
export const deterministicChunkId = (
  scope: Pick<SearchScope, 'projectId' | 'deploymentId' | 'versionSlug'>,
  pageId: string,
  ordinal: number,
  hash: string,
) => {
  const hex = sha256(['nibleaf-search-v1', scope.projectId, scope.deploymentId, scope.versionSlug, pageId, ordinal, hash].join('\0')).slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
};

const normalizeEnglishToken = (token: string): string => {
  const lower = token.toLocaleLowerCase('en');
  if (CODE_TOKEN.test(lower) || lower.length <= 3) return lower;
  // Conservative documentation-oriented stemming. Keep identifiers intact and
  // remove only common productive suffixes; dense retrieval covers semantics.
  for (const suffix of ['ization', 'ational', 'fulness', 'ousness', 'iveness', 'ments', 'ingly', 'edly', 'ing', 'ers', 'ies', 'ed', 'es', 's']) {
    if (lower.endsWith(suffix) && lower.length - suffix.length >= 3) {
      return suffix === 'ies' ? `${lower.slice(0, -3)}y` : lower.slice(0, -suffix.length);
    }
  }
  return lower;
};

const tokenAdapters = new Map<string, SearchTokenAdapter>([['en', (token) => [normalizeEnglishToken(token)]]]);

/** Register a base-language token adapter at process startup. Script detection
 * keeps Arabic tokens first-class inside mixed-language queries regardless of
 * the selected UI language. */
export const registerSearchTokenAdapter = (language: string, adapter: SearchTokenAdapter): void => {
  const base = language.toLocaleLowerCase().split('-')[0];
  if (!base || base === 'ar') throw new TypeError('Use the built-in Arabic token adapter.');
  tokenAdapters.set(base, adapter);
};

export const hybridTokens = (value: string, language = 'en'): string[] => {
  const adapter = tokenAdapters.get(language.toLocaleLowerCase().split('-')[0] ?? '') ?? ((token: string) => [normalizeEnglishToken(token)]);
  return (normalizeArabicSearchText(value).match(TOKEN) ?? [])
    .flatMap((raw) => {
      const normalized = raw.toLocaleLowerCase();
      if (!normalized) return [];
      if (ARABIC.test(normalized) && !/[A-Za-z]/.test(normalized)) return [lightStemArabicToken(normalized)];
      return adapter(normalized);
    })
    .filter((token) => token.length > 1 || CODE_TOKEN.test(token));
};

/** Stable 32-bit term ids let every worker and query process build compatible
 * sparse vectors without a shared vocabulary table. */
export const sparseTermIndex = (token: string): number => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

const sparseFromTokens = (tokens: string[], document = false): SparseVector => {
  const counts = new Map<number, number>();
  for (const token of tokens) {
    const index = sparseTermIndex(token);
    counts.set(index, (counts.get(index) ?? 0) + 1);
  }
  const length = Math.max(1, tokens.length);
  const k1 = 1.2;
  const b = 0.75;
  const averageLength = 120;
  const entries = [...counts.entries()].sort(([left], [right]) => left - right);
  return {
    indices: entries.map(([index]) => index),
    values: entries.map(([, count]) => (document ? (count * (k1 + 1)) / (count + k1 * (1 - b + b * (length / averageLength))) : 1)),
  };
};

const typoTerms = (tokens: string[]): string[] =>
  tokens.flatMap((token) => {
    if (token.length < 5 || token.length > 32 || CODE_TOKEN.test(token)) return [];
    return Array.from({ length: token.length - 2 }, (_, index) => `~3:${token.slice(index, index + 3)}`);
  });

export const sparseVectorForQuery = (query: string, language = 'en'): SparseVector => {
  const tokens = hybridTokens(query, language);
  return sparseFromTokens([...tokens, ...typoTerms(tokens)]);
};

export const sparseVectorForChunk = (chunk: SearchChunk): SparseVector => {
  const title = hybridTokens(chunk.title, chunk.language);
  const heading = hybridTokens(`${chunk.headingPath.join(' ')} ${chunk.heading}`, chunk.language);
  const description = hybridTokens(chunk.description, chunk.language);
  const content = hybridTokens(chunk.content, chunk.language);
  const code = content.filter((token) => CODE_TOKEN.test(token));
  const weighted = [...title, ...title, ...title, ...title, ...heading, ...heading, ...heading, ...description, ...description, ...code, ...content];
  return sparseFromTokens([...weighted, ...typoTerms(weighted)], true);
};

const RTL_LANGUAGES = new Set(['ar', 'fa', 'he', 'ur']);

const markdownHeading = (line: string): { level: number; text: string } | null => {
  let level = 0;
  while (level < 6 && line.charCodeAt(level) === 35) level += 1;
  if (level === 0 || (line.charCodeAt(level) !== 32 && line.charCodeAt(level) !== 9)) return null;
  let textStart = level;
  while (textStart < line.length && (line.charCodeAt(textStart) === 32 || line.charCodeAt(textStart) === 9)) textStart += 1;
  const text = line.slice(textStart);
  return text ? { level, text } : null;
};

interface Section {
  heading: string;
  headingPath: string[];
  body: string;
}

const markdownSections = (content: string): Section[] => {
  const sections: Section[] = [];
  const headingPath: string[] = [];
  let heading = '';
  let body: string[] = [];
  let fenced = false;
  const flush = () => {
    const value = body.join('\n').trim();
    if (value) sections.push({ heading, headingPath: [...headingPath], body: value });
    body = [];
  };
  for (const line of content.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const match = fenced ? null : markdownHeading(line);
    if (!match) {
      body.push(line);
      continue;
    }
    flush();
    const level = match.level;
    heading = plainText(match.text);
    headingPath.length = Math.max(0, level - 1);
    headingPath[level - 1] = heading;
  }
  flush();
  return sections.length > 0 ? sections : [{ heading: '', headingPath: [], body: content }];
};

const splitSection = (body: string, maxChars: number, overlapChars: number): string[] => {
  if (body.length <= maxChars) return [body];
  const blocks = body.split(/\n{2,}/).filter(Boolean);
  const result: string[] = [];
  let current = '';
  for (const block of blocks) {
    if (current && current.length + block.length + 2 > maxChars) {
      result.push(current.trim());
      current = `${current.slice(-overlapChars)}\n\n${block}`;
    } else {
      current = current ? `${current}\n\n${block}` : block;
    }
    while (current.length > maxChars * 1.5) {
      result.push(current.slice(0, maxChars).trim());
      current = current.slice(Math.max(1, maxChars - overlapChars));
    }
  }
  if (current.trim()) result.push(current.trim());
  return result;
};

export interface ChunkOptions {
  maxChars?: number;
  overlapChars?: number;
}

/** Language-aware structural chunking. Headings and fenced code stay attached;
 * Arabic text is never split by a byte/token limit that can corrupt RTL text. */
export const chunkSearchDocument = (
  scope: Pick<SearchScope, 'projectId' | 'deploymentId' | 'versionSlug'>,
  source: SearchChunkSource,
  options: ChunkOptions = {},
): SearchChunk[] => {
  const maxChars = options.maxChars ?? 1400;
  const overlapChars = Math.min(options.overlapChars ?? 180, Math.floor(maxChars / 3));
  let ordinal = 0;
  return markdownSections(source.content).flatMap((section) =>
    splitSection(section.body, maxChars, overlapChars).map((content) => {
      // Hash every field that enters the dense embedding. Metadata-only fields
      // (path/icon/visibility) can then update in place without paying for a new
      // embedding, while title/description/language/content changes cannot reuse
      // a stale vector.
      const contentHash = sha256([source.language, source.title, section.headingPath.join(' > '), source.description, content].join('\0'));
      const chunk: SearchChunk = {
        id: deterministicChunkId(scope, source.id, ordinal, contentHash),
        pageId: source.id,
        ordinal,
        title: source.title,
        path: source.path,
        description: source.description,
        heading: section.heading,
        headingPath: section.headingPath,
        content,
        contentHash,
        language: source.language,
        direction: RTL_LANGUAGES.has(source.language.toLowerCase().split('-')[0] ?? '') ? 'rtl' : 'ltr',
        visible: source.visible,
        icon: source.icon,
      };
      ordinal += 1;
      return chunk;
    }),
  );
};

export const authorizationScopeKey = (allowedPageIds: ReadonlySet<string> | null): string => {
  if (allowedPageIds === null) return 'full';
  return `pages-${sha256(
    [...allowedPageIds]
      .sort()
      .map((id) => `${id.length}:${id}`)
      .join(''),
  ).slice(0, 20)}`;
};

export const searchCacheKey = (scope: SearchScope, query: string, namespace = 'results-v1'): string =>
  [
    namespace,
    scope.projectId,
    scope.deploymentId,
    scope.versionSlug,
    scope.language,
    scope.visibility,
    authorizationScopeKey(scope.allowedPageIds),
    sha256(query.trim()).slice(0, 24),
  ].join(':');

/** Collapse chunk-level retrieval into stable page results without allowing a
 * page absent from the authorized candidate set to appear in counts/citations. */
export const collapseChunkHits = (hits: HybridChunkHit[], limit: number): SearchHit[] => {
  const byPage = new Map<string, HybridChunkHit>();
  for (const hit of hits) {
    const current = byPage.get(hit.chunk.pageId);
    if (!current || hit.score > current.score) byPage.set(hit.chunk.pageId, hit);
  }
  return [...byPage.values()]
    .sort((left, right) => right.score - left.score || left.chunk.pageId.localeCompare(right.chunk.pageId))
    .slice(0, limit)
    .map(({ chunk, score }) => ({
      id: chunk.pageId,
      title: chunk.title,
      path: chunk.path,
      description: chunk.description,
      icon: chunk.icon,
      snippet: plainText(chunk.content).slice(0, 240),
      score,
    }));
};

/** Deterministic second-stage ranking after Qdrant's dense+sparse RRF fusion.
 * It rewards exact phrases, headings/titles, and technical symbols without an
 * LLM query rewrite or cross-tenant statistical state. */
export const rerankHybridChunks = (query: string, hits: HybridChunkHit[]): HybridChunkHit[] => {
  const normalizedQuery = normalizeArabicSearchText(query).toLocaleLowerCase().trim();
  const tokens = new Set(hybridTokens(query));
  const overlap = (value: string): number => {
    const candidate = new Set(hybridTokens(value));
    return [...tokens].filter((token) => candidate.has(token)).length / Math.max(1, tokens.size);
  };
  return hits
    .map((hit) => {
      const searchable = normalizeArabicSearchText(`${hit.chunk.title} ${hit.chunk.heading} ${hit.chunk.content}`).toLocaleLowerCase();
      const phraseBoost = normalizedQuery.length >= 3 && searchable.includes(normalizedQuery) ? 0.18 : 0;
      const headingBoost = overlap(`${hit.chunk.title} ${hit.chunk.headingPath.join(' ')}`) * 0.14;
      const codeBoost = [...tokens].some((token) => CODE_TOKEN.test(token) && searchable.includes(token)) ? 0.08 : 0;
      return { ...hit, score: hit.score + phraseBoost + headingBoost + codeBoost };
    })
    .sort((left, right) => right.score - left.score || left.chunk.id.localeCompare(right.chunk.id));
};

export const retrievalConfidence = (hits: HybridChunkHit[]): number => {
  if (hits.length === 0) return 0;
  const first = Math.max(0, hits[0]?.score ?? 0);
  const second = Math.max(0, hits[1]?.score ?? 0);
  const agreement = hits.length > 1 ? Math.min(1, second / Math.max(first, 0.0001)) : 0.35;
  return Math.max(0, Math.min(1, first * 0.7 + agreement * 0.3));
};
