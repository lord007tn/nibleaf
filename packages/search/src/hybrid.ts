import { createHash } from 'node:crypto';
import { stripMarkdownLinks } from '@nibleaf/shared/utils';
import { lightStemArabicToken, normalizeArabicSearchText } from './arabic';
import type { SearchHit } from './index';

const TOKEN = /[\p{L}\p{M}\p{N}_+.#@:/\\-]+/gu;
const ARABIC = /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/u;
const CODE_TOKEN = /[_+.#@:/\\-]|\d/u;
const VERSION_TOKEN = /^v?\d+(?:\.\d+){1,3}$/u;
export type SearchTokenAdapter = (token: string) => string[];
const HTML_ELEMENTS = new Set(
  'a abbr address area article aside audio b base bdi bdo blockquote body br button canvas caption cite code col colgroup data datalist dd del details dfn dialog div dl dt em embed fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 head header hgroup hr html i iframe img input ins kbd label legend li link main map mark menu meta meter nav noscript object ol optgroup option output p picture pre progress q rp rt ruby s samp script search section select slot small source span strong style sub summary sup table tbody td template textarea tfoot th thead time title tr track u ul var video wbr'.split(
    ' ',
  ),
);

/** Each comment range is consumed once, including an unclosed final comment. */
const withoutComments = (value: string): string => {
  const parts: string[] = [];
  let cursor = 0;
  while (cursor < value.length) {
    const open = value.indexOf('<!--', cursor);
    if (open < 0) break;
    const close = value.indexOf('-->', open + 4);
    parts.push(value.slice(cursor, open), ' ');
    cursor = close < 0 ? value.length : close + 3;
  }
  parts.push(value.slice(cursor));
  return parts.join('');
};

/** Private-use delimiters for code placeholders. Author text can't forge one:
 *  any occurrence in the input is replaced before placeholders are inserted. */
const CODE_OPEN = String.fromCharCode(0xe0_00);
const CODE_CLOSE = String.fromCharCode(0xe0_01);
const CODE_PLACEHOLDER = new RegExp(`${CODE_OPEN}([0-9]+)${CODE_CLOSE}`, 'g');
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/**
 * Moves code out of the prose before markup is stripped, so a fenced
 * `<Button>Save</Button>` or an inline `Map<T>` keeps its literal text and its
 * identifiers stay searchable. Each fenced block and inline code span becomes a
 * placeholder; `restoreCode` puts the literal text back afterwards.
 *
 * This follows CommonMark's code rules with a linear scan rather than a full
 * Markdown parse: search indexes whole pages, not a short prefix, and micromark
 * goes superlinear on marker-dense input (#453).
 * - A fence is 3+ backticks or tildes, indented up to 3 spaces. It closes on a
 *   line of the same character, at least as long; an unclosed fence runs to the
 *   end of the page.
 * - An inline span opens on a run of N backticks and closes on the next run of
 *   exactly N. Each length keeps a forward-only cursor over the runs, so every
 *   run is visited a bounded number of times. An unmatched run stays as text.
 */
const extractCode = (value: string): { prose: string; code: string[] } => {
  const code: string[] = [];
  const hold = (text: string) => `${CODE_OPEN}${code.push(text) - 1}${CODE_CLOSE}`;
  const source = value.replaceAll(CODE_OPEN, ' ').replaceAll(CODE_CLOSE, ' ');

  // Fenced blocks, line by line.
  const lines: string[] = [];
  let fence: { char: string; length: number; body: string[] } | null = null;
  for (const line of source.split('\n')) {
    if (fence) {
      const close = /^ {0,3}(`+|~+)[ \t]*$/.exec(line)?.[1];
      if (close && close[0] === fence.char && close.length >= fence.length) {
        lines.push(hold(fence.body.join('\n')));
        fence = null;
      } else fence.body.push(line);
      continue;
    }
    const open = FENCE_OPEN.exec(line);
    // A backtick fence's info string can't contain a backtick.
    if (open?.[1] && !(open[1][0] === '`' && open[2]?.includes('`'))) {
      fence = { char: open[1][0] ?? '`', length: open[1].length, body: [] };
      continue;
    }
    lines.push(line);
  }
  if (fence) lines.push(hold(fence.body.join('\n')));
  const text = lines.join('\n');

  // Inline code spans: index backtick runs by length, then pair them in order.
  const runs: Array<{ start: number; length: number }> = [];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '`') continue;
    const start = index;
    while (text[index + 1] === '`') index += 1;
    runs.push({ start, length: index - start + 1 });
  }
  const byLength = new Map<number, number[]>();
  runs.forEach((run, position) => {
    const list = byLength.get(run.length);
    if (list) list.push(position);
    else byLength.set(run.length, [position]);
  });
  const cursors = new Map<number, number>();
  let prose = '';
  let cursor = 0;
  for (let position = 0; position < runs.length; position += 1) {
    const run = runs[position];
    if (!run || run.start < cursor) continue;
    const candidates = byLength.get(run.length) ?? [];
    let next = cursors.get(run.length) ?? 0;
    while (next < candidates.length && (candidates[next] ?? 0) <= position) next += 1;
    cursors.set(run.length, next);
    const closePosition = candidates[next];
    const close = closePosition === undefined ? undefined : runs[closePosition];
    if (closePosition === undefined || !close) continue;
    prose += `${text.slice(cursor, run.start)} ${hold(text.slice(run.start + run.length, close.start))} `;
    cursor = close.start + close.length;
    position = closePosition;
  }
  prose += text.slice(cursor);
  return { prose, code };
};

const restoreCode = (value: string, code: readonly string[]): string =>
  value.replace(CODE_PLACEHOLDER, (_, index: string) => ` ${code[Number(index)] ?? ''} `);

export const cleanSearchText = (value: string): string => {
  const { prose, code } = extractCode(value);
  const lines = withoutComments(prose)
    .split('\n')
    .map((line) => {
      const markers = line.trim().replace(/[ \t]/g, '');
      return markers.length >= 3 && /^[-*_]+$/.test(markers) ? '' : line;
    });
  const cleaned = stripMarkdownLinks(lines.join('\n'))
    // MDX and HTML are layout. CLI placeholders such as <name> stay readable.
    // Attributes are bounded, so an unclosed tag can't make the scan quadratic.
    // Code is held out above, so this only ever strips markup from prose.
    .replace(/<\/?([A-Za-z][\w.:-]{0,64})(?:\s[^<>]{0,512})?\/?>/g, (tag: string, name: string) =>
      /^[A-Z]/.test(name) || HTML_ELEMENTS.has(name) ? ' ' : tag,
    );
  const prosePass = cleaned
    .replace(/\[!\w+\]/g, ' ')
    .replace(/(^|\s)\\[-*+]\s*(?:\d+[-.)]\s*)?/gm, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^(?:>\s*|[-*+]\s+)/gm, '')
    .replace(/^[ \t]*\d+[.)][ \t]+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/(^|\s)[*_]([^*_\n]+)[*_](?=\s|$)/g, '$1$2');
  // Code comes back verbatim, after every prose rule has run.
  return restoreCode(prosePass, code)
    .replace(/\s+/g, ' ')
    .replace(/ ([.,;:!?،؛])/g, '$1')
    .trim();
};

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
  /** The page's headings with the DOM ids the reader renders for them, in
   * document order (`extractHeadings` from `@nibleaf/shared/site`, the same
   * github-slugger ids as the table of contents). Chunks link their section by it. */
  anchors?: ReadonlyArray<{ text: string; id: string }>;
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
  /** DOM id of the section this chunk is in, as the published page renders it:
   * its own heading's, or its nearest ancestor's when its heading has none (the
   * reader gives ids to h1–h4 only). Absent at the top of a page, before any heading. */
  anchor?: string;
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
  let hash = 0x81_1c_9d_c5;
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 0x01_00_01_93);
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
  /** 1–6; 0 for the text before the first heading. */
  level: number;
  body: string;
}

const markdownSections = (content: string): Section[] => {
  const sections: Section[] = [];
  const headingPath: string[] = [];
  let heading = '';
  let level = 0;
  let body: string[] = [];
  let fenced = false;
  const flush = () => {
    const value = body.join('\n').trim();
    // Imported docs may put a complete definition in a heading with no body.
    if (value || heading) sections.push({ heading, headingPath: headingPath.filter(Boolean), level, body: value || heading });
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
    level = match.level;
    heading = cleanSearchText(match.text);
    headingPath.length = Math.max(0, level - 1);
    headingPath[level - 1] = heading;
  }
  flush();
  return sections.length > 0 ? sections : [{ heading: '', headingPath: [], level: 0, body: content }];
};

/** Heading text compared the way both sides agree on: the chunker reads raw
 * Markdown headings, the reader strips inline Markdown, so only letters and
 * digits count (any script), case-folded. */
export const sectionHeadingKey = (text: string): string =>
  text
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** The anchor of each section, matched to the page's rendered headings in
 * document order: each section takes the next rendered heading with the same
 * text, so a repeated heading ("Example", "Example") gets its own id (`example`,
 * `example-1`), never the first one's. A heading the reader gives no id (h5, h6),
 * or one that does not match, uses its nearest ancestor's anchor; the text before
 * any heading has none. */
const sectionAnchors = (sections: readonly Section[], anchors: ReadonlyArray<{ text: string; id: string }>): (string | undefined)[] => {
  const keys = anchors.map((anchor) => sectionHeadingKey(anchor.text));
  const byLevel: (string | undefined)[] = [];
  const result: (string | undefined)[] = [];
  let next = 0;
  for (const section of sections) {
    let anchor: string | undefined;
    if (section.level) {
      const key = sectionHeadingKey(section.heading);
      const found = key ? keys.indexOf(key, next) : -1;
      byLevel.length = section.level - 1;
      anchor = found >= 0 ? anchors[found]?.id : byLevel.findLast((ancestor) => ancestor !== undefined);
      if (found >= 0) next = found + 1;
      byLevel[section.level - 1] = anchor;
    }
    result.push(anchor);
  }
  return result;
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
  const sections = markdownSections(source.content);
  const anchors = sectionAnchors(sections, source.anchors ?? []);
  return sections.flatMap((section, index) =>
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
        ...(anchors[index] ? { anchor: anchors[index] } : {}),
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

/** The text indexing embeds for a chunk: title, heading path, description and content. */
export const searchEmbeddingText = (chunk: SearchChunk): string =>
  [`# ${chunk.title}`, chunk.headingPath.length > 0 ? chunk.headingPath.join(' > ') : '', chunk.description, chunk.content]
    .filter(Boolean)
    .join('\n\n');

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
export const collapseChunkHits = (hits: HybridChunkHit[], limit: number, query = ''): SearchHit[] => {
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
      snippet: searchChunkSnippet(chunk, query),
      score,
    }));
};

/** Keep the matching passage visible, including code identifiers and Arabic
 * morphology, instead of always showing a chunk's unrelated opening. */
export const searchChunkSnippet = (chunk: SearchChunk, query = '', maxChars = 240): string => {
  const text = cleanSearchText(chunk.content);
  if (text.length <= maxChars) return text;
  const terms = new Set(hybridTokens(query, chunk.language));
  const words = [...text.matchAll(TOKEN)];
  const matches = words.filter((word) => hybridTokens(word[0], chunk.language).some((term) => terms.has(term)));
  const lead = Math.floor(maxChars / 5);
  let start = 0;
  let bestCoverage = 0;
  for (const match of matches) {
    const proposed = Math.min(Math.max(0, match.index - lead), Math.max(0, text.length - maxChars));
    const candidate = proposed === 0 ? 0 : text.indexOf(' ', proposed) + 1;
    const coverage = new Set(
      matches
        .filter((word) => word.index >= candidate && word.index + word[0].length <= candidate + maxChars - 2)
        .flatMap((word) => hybridTokens(word[0], chunk.language).filter((term) => terms.has(term))),
    ).size;
    if (coverage > bestCoverage) {
      bestCoverage = coverage;
      start = candidate;
    }
  }
  const available = maxChars - (start > 0 ? 1 : 0) - 1;
  const end = Math.min(text.length, start + available);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
};

/** Preserve the retrieved evidence in ranking order, without duplicate passages.
 * The default matches the bounded answer retrieval; another diversity pass can
 * discard a complementary definition that retrieval already found. */
export const selectAnswerChunks = (hits: HybridChunkHit[], limit = 12): SearchChunk[] => {
  if (limit <= 0) return [];
  const selected: SearchChunk[] = [];
  const seenChunks = new Set<string>();
  for (const { chunk } of hits) {
    if (seenChunks.has(chunk.id)) continue;
    selected.push(chunk);
    seenChunks.add(chunk.id);
    if (selected.length >= limit) break;
  }
  return selected;
};

/** Deterministic second-stage ranking after Qdrant's dense+sparse RRF fusion.
 * It rewards exact phrases, headings/titles, and technical symbols without an
 * LLM query rewrite or cross-tenant statistical state. */
export const rerankHybridChunks = (query: string, hits: HybridChunkHit[]): HybridChunkHit[] => {
  const normalizedQuery = normalizeArabicSearchText(query).toLocaleLowerCase().trim();
  const tokens = new Set(hybridTokens(query));
  const matchesVersion = (token: string, candidate: string) =>
    VERSION_TOKEN.test(candidate) && (candidate === token || candidate.startsWith(`${token}.`));
  const overlap = (value: string): number => {
    const candidate = new Set(hybridTokens(value));
    return (
      [...tokens].filter((token) => candidate.has(token) || (VERSION_TOKEN.test(token) && [...candidate].some((term) => matchesVersion(token, term))))
        .length / Math.max(1, tokens.size)
    );
  };
  return hits
    .map((hit) => {
      const searchable = normalizeArabicSearchText(`${hit.chunk.title} ${hit.chunk.heading} ${hit.chunk.content}`).toLocaleLowerCase();
      const candidateTokens = hybridTokens(searchable);
      const versionsMatch = [...tokens]
        .filter((token) => VERSION_TOKEN.test(token))
        .every((token) => candidateTokens.some((term) => matchesVersion(token, term)));
      const phraseBoost = normalizedQuery.length >= 3 && searchable.includes(normalizedQuery) && versionsMatch ? 0.18 : 0;
      const headingBoost = overlap(`${hit.chunk.title} ${hit.chunk.headingPath.join(' ')}`) * 0.14;
      const codeBoost = [...tokens].some((token) =>
        VERSION_TOKEN.test(token)
          ? candidateTokens.some((term) => matchesVersion(token, term))
          : CODE_TOKEN.test(token) && searchable.includes(token),
      )
        ? 0.08
        : 0;
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
