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

/** A preview of the section body around the first matching word, cut on whole words. */
function sectionSnippet(lines: string[], tokens: string[]): string {
  // Keep code text (a reader may search for a command) but drop the fence markers.
  const text = stripMarkdown(lines.filter((line) => !line.trimStart().startsWith('```')).join('\n'));
  if (text.length <= SNIPPET_LENGTH) return text;
  const lower = normalize(text);
  const hit = tokens.map((token) => lower.indexOf(token)).filter((index) => index >= 0);
  const anchor = hit.length > 0 ? Math.min(...hit) : 0;
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
  const candidates = sections.filter(({ heading }) => heading.depth > 1);
  // Prefer a heading that names the query, then the first section that mentions it.
  const match =
    candidates.find(({ heading }) => tokens.every((token) => normalize(heading.text).includes(token))) ??
    candidates.find(({ lines }) => {
      const text = normalize(lines.join(' '));
      return tokens.some((token) => text.includes(token));
    });
  if (!match) return undefined;
  return { section: { id: match.heading.id, title: match.heading.text }, snippet: sectionSnippet(match.lines, tokens) };
}
