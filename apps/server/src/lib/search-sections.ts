import { normalizeArabicSearchText, stripMarkdown } from '@nibleaf/search';
import { extractHeadings } from '@nibleaf/shared/site';

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
  let value = '';
  const offsets: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    for (const char of normalize(text[index] ?? '')) {
      value += char;
      offsets.push(index);
    }
  }
  offsets.push(text.length);
  return { value, offsets };
}

/** A preview of the section body around the first matching word, cut on whole words. */
function sectionSnippet(lines: string[], tokens: string[]): string {
  // Keep code text (a reader may search for a command) but drop the fence markers.
  const text = stripMarkdown(lines.filter((line) => !line.trimStart().startsWith('```')).join('\n'));
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

/**
 * Finds the section of a page that a keyword query matched, so the reader can
 * jump straight to that heading, with a preview taken from that section.
 * Returns nothing when the page title already covers the query (the page itself
 * is the best target) or when the match is only in the introduction.
 */
export function matchedSearchSection(
  page: { title: string; content: string },
  query: string,
): { section: SearchHitSection; snippet: string } | undefined {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return undefined;
  const title = normalize(page.title);
  if (tokens.every((token) => title.includes(token))) return undefined;

  // Split the body into sections, mirroring extractHeadings' line walk so the
  // nth heading line maps to the nth extracted heading (and its anchor id).
  const headings = extractHeadings(page.content);
  const sections: Array<{ heading: (typeof headings)[number]; lines: string[] }> = [];
  let index = 0;
  let inFence = false;
  for (const line of page.content.split('\n')) {
    const fence = line.trimStart().startsWith('```');
    if (!(inFence || fence) && HEADING_LINE.test(line) && index < headings.length) {
      const heading = headings[index];
      index += 1;
      if (heading) sections.push({ heading, lines: [] });
      continue;
    }
    if (fence) inFence = !inFence;
    sections.at(-1)?.lines.push(line);
  }
  // Score every section: a heading that names the whole query wins outright,
  // heading words weigh more than body words, and more matched words beat fewer.
  // Ties keep document order.
  let match: (typeof sections)[number] | undefined;
  let bestScore = 0;
  for (const section of sections) {
    if (section.heading.depth <= 1) continue;
    const heading = normalize(section.heading.text);
    const body = normalize(section.lines.join(' '));
    const headingHits = tokens.filter((token) => heading.includes(token)).length;
    const bodyHits = tokens.filter((token) => body.includes(token)).length;
    if (headingHits + bodyHits === 0) continue;
    const score = (headingHits === tokens.length ? 100 : 0) + headingHits * 3 + bodyHits;
    if (score > bestScore) {
      match = section;
      bestScore = score;
    }
  }
  if (!match) return undefined;
  return { section: { id: match.heading.id, title: match.heading.text }, snippet: sectionSnippet(match.lines, tokens) };
}
