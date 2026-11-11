import { cleanSearchText, normalizeArabicSearchText } from '@nibleaf/search';
import { fencedMarkdownLines } from '@nibleaf/shared/markdown-code';
import { extractHeadings, type Heading } from '@nibleaf/shared/site';
import { LruCache } from './lru';

export interface SearchHitSection {
  /** DOM anchor of the heading (github-slugger, identical to the reader's ids). */
  id: string;
  title: string;
}

const SNIPPET_LENGTH = 180;
const HEADING_LINE = /^#{1,4}\s+\S/;

const normalize = (value: string): string => normalizeArabicSearchText(value).toLowerCase();

const queryTokens = (query: string): string[] =>
  normalize(query)
    .split(/\s+/)
    .filter((token) => token.length >= 2);

function normalizeWithOffsets(text: string): { value: string; offsets: number[] } {
  // Collected and joined once: appending one character at a time to a string is
  // quadratic in V8 on long sections.
  const chars: string[] = [];
  const offsets: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    for (const char of normalize(text[index] ?? '')) {
      chars.push(char);
      offsets.push(index);
    }
  }
  offsets.push(text.length);
  return { value: chars.join(''), offsets };
}

/** A preview of the section body around the first matching word, cut on whole words. */
function sectionSnippet(text: string, tokens: string[]): string {
  // Keep code text (a reader may search for a command) but drop the fence markers.
  if (text.length <= SNIPPET_LENGTH) return text;
  // Match in normalized text (no Arabic diacritics, folded alef forms), then map
  // the position back to the original text so the window stays on the match.
  const normalized = normalizeWithOffsets(text);
  const hit = tokens.map((token) => normalized.value.indexOf(token)).filter((index) => index >= 0);
  const anchor = hit.length > 0 ? (normalized.offsets[Math.min(...hit)] ?? 0) : 0;
  let start = Math.max(0, anchor - SNIPPET_LENGTH / 3);
  if (start > 0) {
    const space = text.indexOf(' ', start);
    start = space !== -1 && space < anchor ? space + 1 : start;
  }
  let end = Math.min(text.length, start + SNIPPET_LENGTH);
  if (end < text.length) {
    const space = text.lastIndexOf(' ', end);
    if (space > anchor) end = space;
  }
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

interface ParsedSection {
  heading: Heading;
  text: string;
  /** Normalized heading and body text, so scoring does no per-query normalization. */
  headingText: string;
  bodyText: string;
}

/** Parsed sections per published page; a new deployment uses new keys. */
const parsedSections = new LruCache<string, ParsedSection[]>(500);

/** Split a page body into sections, mirroring extractHeadings' line walk so the
 *  nth heading line maps to the nth extracted heading (and its anchor id). */
function parseSections(content: string): ParsedSection[] {
  const headings = extractHeadings(content);
  const sections: Array<{ heading: Heading; lines: string[] }> = [];
  let index = 0;
  const lines = content.split('\n');
  // The same fence rules as extractHeadings, so a `#` line in code never becomes a section.
  const fenced = fencedMarkdownLines(lines);
  for (const [lineIndex, line] of lines.entries()) {
    if (!fenced[lineIndex] && HEADING_LINE.test(line) && index < headings.length) {
      const heading = headings[index];
      index += 1;
      if (heading) sections.push({ heading, lines: [] });
      continue;
    }
    sections.at(-1)?.lines.push(line);
  }
  return sections.map((section) => {
    const text = cleanSearchText(section.lines.join('\n'));
    return { heading: section.heading, text, headingText: normalize(section.heading.text), bodyText: normalize(text) };
  });
}

/**
 * Finds the section of a page that a keyword query matched, so the reader can
 * jump straight to that heading, with a preview taken from that section.
 * Returns nothing when the page title already covers the query (the page itself
 * is the best target) or when the match is only in the introduction.
 */
export function matchedSearchSection(
  page: { title: string; content: string },
  query: string,
  /** Stable identity of this published page (deployment + page id) to reuse its parsed sections. */
  cacheKey?: string,
): { section: SearchHitSection; snippet: string } | undefined {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return undefined;
  const title = normalize(page.title);
  if (tokens.every((token) => title.includes(token))) return undefined;

  let sections = cacheKey ? parsedSections.get(cacheKey) : undefined;
  if (!sections) {
    sections = parseSections(page.content);
    if (cacheKey) parsedSections.set(cacheKey, sections);
  }
  // Score every section: a heading that names the whole query wins outright,
  // heading words weigh more than body words, and more matched words beat fewer.
  // Ties keep document order.
  let match: ParsedSection | undefined;
  let bestScore = 0;
  for (const section of sections) {
    if (section.heading.depth <= 1) continue;
    const headingHits = tokens.filter((token) => section.headingText.includes(token)).length;
    const bodyHits = tokens.filter((token) => section.bodyText.includes(token)).length;
    if (headingHits + bodyHits === 0) continue;
    const score = (headingHits === tokens.length ? 100 : 0) + headingHits * 3 + bodyHits;
    if (score > bestScore) {
      match = section;
      bestScore = score;
    }
  }
  if (!match) return undefined;
  return { section: { id: match.heading.id, title: match.heading.text }, snippet: sectionSnippet(match.text, tokens) };
}
