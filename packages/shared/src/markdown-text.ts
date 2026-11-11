/**
 * Visible prose from Markdown/MDX, for descriptions, OG cards, llms.txt and exports.
 *
 * SERVER-ONLY: this parses with remark, so browser code must never import it.
 * Browser code only truncates text the server already cleaned, using
 * `truncateText` from `./utils`.
 *
 * Only visible prose is emitted. Dropped: YAML/TOML frontmatter; HTML (comments,
 * raw tags, and the content of inline <script>/<style>); MDX expressions,
 * including `{/* … *\/}` JSX comments; ESM; JSX attributes; code blocks; images
 * and image references; link and footnote definitions; callout markers.
 * Character references (named, decimal, hex) are decoded by the parser. Invalid
 * MDX falls back to plain GFM, where JSX tags are HTML and are dropped.
 *
 * Cost bounds. Author content reaches this on public routes, so it must never block:
 * - frontmatter is removed with a linear scan, and only a short prefix is parsed
 *   (1.5 KB, widened to 4 KB when it yields too little prose; an excerpt needs
 *   about 160 visible characters);
 * - micromark is linear for normal Markdown but superlinear for long runs of
 *   emphasis/bracket/tag markers, and a synchronous parse can't be interrupted, so
 *   such input is detected beforehand (marker count) and goes to a linear
 *   text-strip instead;
 * - results are cached per content (bounded LRU), so any cost is paid once.
 */
import { createHash } from 'node:crypto';
import type { Nodes, Root } from 'mdast';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkMdx from 'remark-mdx';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { explicitPageDescription, type SnapshotPage, type SnapshotPageConfig } from './site';
import { stripMarkdownLinks, truncateText } from './utils';

/** Parse a short prefix first (enough visible text for an excerpt on typical
 *  pages), and widen only when it yields too little prose. */
const PREFIXES = [1536, 4096] as const;
const ENOUGH_TEXT = 200;
/** micromark's superlinear paths (emphasis, brackets, tags) grow with the NUMBER
 *  of markers. 8192 `*` cost about 750 ms locally, and a few hundred already cost
 *  tens of ms on CI runners. Above this count the parse is skipped for the
 *  linear strip, which keeps link text and drops URLs and images, so a
 *  marker-heavy page still gets a clean description. */
const MAX_MARKERS = 200;
const MARKERS = new Set(['*', '_', '[', ']', '<', '>', '{', '}', '`', '!', '~', '|']);
const CACHE_LIMIT = 2000;

const mdx = unified().use(remarkParse).use(remarkFrontmatter, ['yaml', 'toml']).use(remarkGfm).use(remarkMdx);
const markdown = unified().use(remarkParse).use(remarkFrontmatter, ['yaml', 'toml']).use(remarkGfm);

/** Removes `open … close` spans in one forward pass; an unclosed span is kept. */
const stripSpans = (value: string, open: string, close: string): string => {
  let output = '';
  let cursor = 0;
  while (cursor < value.length) {
    const start = value.indexOf(open, cursor);
    if (start === -1) break;
    const end = value.indexOf(close, start + open.length);
    if (end === -1) break;
    output += `${value.slice(cursor, start)} `;
    cursor = end + close.length;
  }
  return output + value.slice(cursor);
};

const RAW_REGIONS = [
  { open: '<!--', close: '-->' },
  { open: '<script', close: '</script' },
  { open: '<style', close: '</style' },
] as const;

/** Removes HTML comments and <script>/<style> elements with their content. An
 *  unclosed one hides the rest, as in CommonMark. One forward pass: each
 *  opener's next position is cached and only searched again once the cursor
 *  passes it, so no input is rescanned. */
const dropRawRegions = (value: string): string => {
  const lower = value.toLowerCase();
  const next = RAW_REGIONS.map(({ open }) => lower.indexOf(open));
  let output = '';
  let cursor = 0;
  for (;;) {
    for (const [index, region] of RAW_REGIONS.entries()) {
      if ((next[index] ?? -1) !== -1 && (next[index] ?? 0) < cursor) next[index] = lower.indexOf(region.open, cursor);
    }
    let pick = -1;
    for (const [index, position] of next.entries()) if (position !== -1 && (pick === -1 || position < (next[pick] ?? 0))) pick = index;
    if (pick === -1) return output + value.slice(cursor);
    const start = next[pick] ?? 0;
    const region = RAW_REGIONS[pick];
    if (!region) return output + value.slice(cursor);
    output += `${value.slice(cursor, start)} `;
    const close = lower.indexOf(region.close, start + region.open.length);
    if (close === -1) return output;
    const end = region.close === '-->' ? close + 3 : lower.indexOf('>', close);
    if (end === -1) return output;
    cursor = region.close === '-->' ? end : end + 1;
  }
};

/** A leading `---` YAML or `+++` TOML block, removed with a linear line scan. */
const stripFrontmatter = (source: string): string => {
  for (const fence of ['---', '+++']) {
    if (!source.startsWith(`${fence}\n`) && !source.startsWith(`${fence}\r\n`)) continue;
    const lines = source.split('\n');
    for (let index = 1; index < lines.length; index += 1) {
      if (lines[index]?.trim() === fence) return lines.slice(index + 1).join('\n');
    }
  }
  return source;
};

/** Never-blocking fallback: drop fenced code, comments and tags, then Markdown
 *  punctuation. Every step is one forward pass. */
const linearStrip = (source: string): string => {
  const prose: string[] = [];
  let fence: string | null = null;
  for (const line of source.split('\n')) {
    const marker = /^\s*(`{3,}|~{3,})/u.exec(line)?.[1];
    if (marker && (!fence || marker.startsWith(fence))) {
      fence = fence ? null : marker;
      continue;
    }
    if (!fence) prose.push(line);
  }
  // stripMarkdownLinks is a single forward pass: link text stays, URLs and images go.
  let text = stripMarkdownLinks(stripSpans(dropRawRegions(prose.join('\n')), '{/*', '*/}'));
  let output = '';
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? '';
    if (char === '<') {
      const end = text.indexOf('>', index + 1);
      if (end !== -1 && /[A-Za-z/!]/u.test(text[index + 1] ?? '')) {
        output += ' ';
        index = end;
        continue;
      }
    }
    // Inline formatting markers vanish ("**details**." → "details."), `_` survives
    // inside words ("api_key"), and structural markers become spaces.
    if (char === '*' || char === '~' || char === '`' || char === '\\') continue;
    if (char === '_' && /[\p{L}\p{N}]/u.test(text[index - 1] ?? '') && /[\p{L}\p{N}]/u.test(text[index + 1] ?? '')) {
      output += char;
      continue;
    }
    output += MARKERS.has(char) || char === '#' ? ' ' : char;
  }
  text = output;
  return text.replace(/\s+/gu, ' ').trim();
};

const SKIP = new Set([
  'yaml',
  'toml',
  'code',
  'image',
  'imageReference',
  'definition',
  'footnoteDefinition',
  'footnoteReference',
  'mdxFlowExpression',
  'mdxTextExpression',
  'mdxjsEsm',
  'thematicBreak',
]);
const BLOCK = new Set(['paragraph', 'heading', 'listItem', 'tableCell', 'blockquote', 'tableRow', 'list', 'table', 'mdxJsxFlowElement', 'html']);
const CALLOUT_MARKER = /^\s*\[![A-Za-z]+\][+-]?\s*/u;
/** Ghost/Mintlify imports escape numbered steps as `\-1- …`; the text is `-1- …`. */
const IMPORTED_STEP = /^\s*-\d+-\s*/u;
/** An image reference with no definition is literal text to the parser. */
const UNRESOLVED_IMAGE = /!\[[^[\]\n]*\](?:\[[^[\]\n]*\])?/gu;
const RAW_TEXT_OPEN = /^<(script|style)\b/iu;

interface Walk {
  parts: string[];
  /** Inside an inline <script>/<style>: its text is code, not prose. */
  rawText: string | null;
}

const collect = (node: Nodes, walk: Walk): void => {
  if (node.type === 'html') {
    const open = RAW_TEXT_OPEN.exec(node.value)?.[1]?.toLowerCase();
    if (open && !new RegExp(`</${open}\\s*>\\s*$`, 'iu').test(node.value)) walk.rawText = open;
    else if (walk.rawText && node.value.toLowerCase().startsWith(`</${walk.rawText}`)) walk.rawText = null;
    walk.parts.push(' ');
    return;
  }
  if (SKIP.has(node.type) || walk.rawText) return;
  // In MDX, <script>/<style> parse as JSX elements; their content is code, not prose.
  if ((node.type === 'mdxJsxTextElement' || node.type === 'mdxJsxFlowElement') && /^(?:script|style)$/iu.test(node.name ?? '')) return;
  if (node.type === 'text' || node.type === 'inlineCode') {
    walk.parts.push(node.type === 'text' ? node.value.replace(UNRESOLVED_IMAGE, ' ') : node.value);
    return;
  }
  if (node.type === 'break') {
    walk.parts.push(' ');
    return;
  }
  if (!('children' in node)) return;
  const isBlock = BLOCK.has(node.type);
  if (isBlock) walk.parts.push('\n');
  const start = walk.parts.length;
  for (const child of node.children as Nodes[]) collect(child, walk);
  if (node.type === 'paragraph' && walk.parts.length > start) {
    walk.parts[start] = (walk.parts[start] ?? '').replace(CALLOUT_MARKER, '').replace(IMPORTED_STEP, '');
  }
  if (isBlock) walk.parts.push('\n');
};

const parse = (source: string): Root => {
  try {
    return mdx.parse(source);
  } catch {
    return markdown.parse(stripSpans(source, '{/*', '*/}'));
  }
};

const markerCount = (source: string): number => {
  let markers = 0;
  for (const char of source) if (MARKERS.has(char)) markers += 1;
  return markers;
};

const cache = new Map<string, string>();

/** Raw HTML that opens inside the prefix but doesn't close there: the parser
 *  would scan it to the end, so it is stripped linearly instead. */
const hasUnclosedRawHtml = (prefix: string): boolean => {
  const lower = prefix.toLowerCase();
  const comment = lower.indexOf('<!--');
  if (comment !== -1 && lower.indexOf('-->', comment + 4) === -1) return true;
  for (const tag of ['script', 'style']) {
    const open = lower.indexOf(`<${tag}`);
    if (open !== -1 && lower.indexOf(`</${tag}`, open) === -1) return true;
  }
  return false;
};

const extractPrefix = (prefix: string): string => {
  if (markerCount(prefix) > MAX_MARKERS || hasUnclosedRawHtml(prefix)) return linearStrip(prefix);
  const walk: Walk = { parts: [], rawText: null };
  collect(parse(prefix), walk);
  return walk.parts
    .join('')
    .split('\n')
    .map((line) => line.replace(/\s+/gu, ' ').trim())
    .filter(Boolean)
    .join(' ');
};

const extract = (source: string): string => {
  const body = stripFrontmatter(source);
  let text = '';
  for (const size of PREFIXES) {
    text = extractPrefix(body.slice(0, size));
    if (text.length >= ENOUGH_TEXT || body.length <= size) break;
  }
  return text;
};

/** Visible prose of a Markdown/MDX document as one line of plain text. */
export const markdownToPlainText = (source: string): string => {
  if (!source) return '';
  const key = createHash('sha1').update(source).digest('base64');
  const hit = cache.get(key);
  if (hit !== undefined) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const text = extract(source);
  cache.set(key, text);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  return text;
};

/** Word-boundary summary of Markdown, counting graphemes. */
export const excerpt = (source: string, max = 160): string => truncateText(markdownToPlainText(source), max);

/** A summary derived from the page body for machine surfaces (SEO/social meta,
 *  llms.txt, exports), never shown as a visible lede. */
export const pageExcerpt = (page: Pick<SnapshotPage, 'content'>, max = 160): string => excerpt(page.content, max);

/** One-line description: the author's SEO override, then their summary, then the body. */
export const pageDescription = (page: Pick<SnapshotPage, 'description' | 'content'> & { config?: SnapshotPageConfig | null }): string =>
  excerpt(page.config?.seo?.metaDescription?.trim() || explicitPageDescription(page) || page.content);
