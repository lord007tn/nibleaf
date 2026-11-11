/**
 * The reader's Markdown source normalization: what `RichMarkdown` feeds to
 * CommonMark before rendering. Shared so the pre-publish link checks read a
 * page exactly as the reader does (apps/app/src/components/site/mdx-config.ts
 * re-exports it for the reader). Pure string work; no parsers.
 */
import { type DocumentationComponentContract, documentationComponentContractEntries } from './documentation-component-contract';
import { fencedMarkdownLines } from './markdown-code';

const CONTRACT = documentationComponentContractEntries();
/** Block-level component tags whose inner content should be parsed as Markdown. */
export const MDX_BLOCK_TAGS: readonly string[] = CONTRACT.flatMap(([tag, component]) => (component.markdownBody ? [tag] : []));
const BLOCK_TAGS = MDX_BLOCK_TAGS.join('|');
// One piece of a tag's attribute text: a character that isn't `>` or a quote,
// or a whole quoted value on one line, so `title="a > b"` doesn't end the tag
// early. A quote that isn't closed on its line (an apostrophe inside
// title={`it's`}) is an ordinary character, so it can't run on.
const LONE_QUOTE = `"(?![^"\\n]*")|'(?![^'\\n]*')`;
const ATTRIBUTE_PART = `(?:[^>"']|"[^"\\n]*"|'[^'\\n]*'|${LONE_QUOTE})`;
// Attribute text that doesn't end in `/`, so `<Tag … />` isn't read as an opener.
const OPENING_ATTRIBUTES = `(?:${ATTRIBUTE_PART}*(?:[^/>"']|"[^"\\n]*"|'[^'\\n]*'|${LONE_QUOTE}))?`;

/**
 * Rewrites authored component tags into what the HTML parser must see:
 *  1. Self-closing components are expanded into an explicit pair, because HTML
 *     parsers do not honor XML self-closing syntax on unknown elements (sibling
 *     File/RelatedCard nodes would otherwise nest).
 *  2. Tags whose lowercase name is a real HTML element are renamed
 *     (`<Frame>` → `<mdxframe>`; the HTML5 parser drops `<frame>` outside a
 *     frameset). The leading "<" is kept (capture group 1 is only the optional
 *     closing slash) so the tag stays well-formed.
 * Expansion runs first so it matches authored names even for a component that
 * is both self-closing and renamed.
 */
export const readerTagRewriter = (contract: ReadonlyArray<readonly [string, DocumentationComponentContract]>): ((text: string) => string) => {
  const selfClosing = contract.flatMap(([tag, component]) => (component.selfClosing ? [tag] : []));
  const selfClosingTag = selfClosing.length > 0 ? new RegExp(`<(${selfClosing.join('|')})\\b(${ATTRIBUTE_PART}*?)\\/>`, 'gi') : null;
  const renames = contract.flatMap(([tag, component]) =>
    component.readerTag ? [{ pattern: new RegExp(`<(\\/?)${tag}\\b`, 'gi'), replacement: `<$1${component.readerTag}` }] : [],
  );
  return (text) => {
    const expanded = selfClosingTag ? text.replace(selfClosingTag, '<$1$2></$1>') : text;
    return renames.reduce((renamed, { pattern, replacement }) => renamed.replace(pattern, replacement), expanded);
  };
};
const rewriteReaderTags = readerTagRewriter(CONTRACT);
// Matches an opening block tag on its own line — with or without attributes —
// but not a self-closing tag (`<Frame />`).
const OPEN_TAG = new RegExp(`^\\s*<(?:${BLOCK_TAGS})\\b${OPENING_ATTRIBUTES}>\\s*$`, 'i');
const CLOSE_TAG = new RegExp(`^\\s*</(?:${BLOCK_TAGS})>\\s*$`, 'i');
const COMPONENT_LINE = new RegExp(`^\\s*</?(?:${BLOCK_TAGS})\\b${ATTRIBUTE_PART}*>\\s*$`, 'i');
// A block component opened and closed on one line: `<Callout type="tip">Text</Callout>`.
const ONE_LINE_BLOCK = new RegExp(`^(\\s*)<(${BLOCK_TAGS})\\b(${OPENING_ATTRIBUTES})>(.*\\S.*)</\\2>\\s*$`, 'i');
// Inline code spans (`<Frame>` written as an example) are code too.
const INLINE_CODE = /(`+)[\s\S]*?\1/g;
// The start of a block opener whose attributes go on to later lines.
const OPENER_START = new RegExp(`^\\s*<(?:${BLOCK_TAGS})(?:\\s|$)`, 'i');
const MAX_OPENER_LINES = 32;

/** Join an opening block tag written over several lines (`<Card\n  title="x"\n>`)
 *  onto one line, so the steps below see it as a tag. Line by line, its lone
 *  `>` would otherwise start a blockquote and the tag would render as text. Only
 *  a run of non-blank prose lines that forms a whole opener is joined. */
const joinMultilineOpeners = (lines: readonly string[], fenced: readonly boolean[]): { lines: string[]; fenced: boolean[] } => {
  const out: string[] = [];
  const outFenced: boolean[] = [];
  const openerEnd = (i: number): number => {
    const line = lines[i] ?? '';
    if (fenced[i] || !OPENER_START.test(line) || OPEN_TAG.test(line) || ONE_LINE_BLOCK.test(line)) return -1;
    let joined = line.trimEnd();
    for (let j = i + 1; j < lines.length && j - i < MAX_OPENER_LINES && !fenced[j] && (lines[j] ?? '').trim() !== ''; j++) {
      joined += ` ${(lines[j] ?? '').trim()}`;
      if (OPEN_TAG.test(joined)) return j;
    }
    return -1;
  };
  for (let i = 0; i < lines.length; i++) {
    const end = openerEnd(i);
    if (end < 0) {
      out.push(lines[i] ?? '');
      outFenced.push(Boolean(fenced[i]));
      continue;
    }
    out.push([(lines[i] ?? '').trimEnd(), ...lines.slice(i + 1, end + 1).map((part) => part.trim())].join(' '));
    outFenced.push(false);
    i = end;
  }
  return { lines: out, fenced: outFenced };
};

/** An inline code span (kept as written) or an MDX comment `{/* … *\/}` (removed),
 *  whichever starts first, so a comment containing backticks is still one comment
 *  and a comment shown inside inline code stays an example. */
const CODE_OR_MDX_COMMENT = /(`+)[\s\S]*?\1|\{\s*\/\*[\s\S]*?\*\/\s*\}/g;

/** MDX comments are authoring notes: MDX drops them, so the reader must not show
 *  them (or any link inside them). Fenced code and inline code keep them as written;
 *  an indented line is not code in MDX, so a comment there is dropped too. A comment
 *  may span lines; an unclosed `{/*` is left as text. */
const stripMdxComments = (lines: readonly string[], fenced: readonly boolean[]): string[] => {
  const out: string[] = [];
  let start = 0;
  for (let index = 1; index <= lines.length; index += 1) {
    if (index < lines.length && Boolean(fenced[index]) === Boolean(fenced[start])) continue;
    const run = lines.slice(start, index);
    if (fenced[start]) out.push(...run);
    else
      out.push(
        ...run
          .join('\n')
          .replace(CODE_OR_MDX_COMMENT, (match, code: string | undefined) => (code ? match : ''))
          .split('\n'),
      );
    start = index;
  }
  return out;
};

/** Ensure block component tags are separated from their inner content by a blank
 *  line, so CommonMark parses the children as Markdown. Without this, content
 *  directly after `<Note>` is captured as a raw HTML block and inline Markdown
 *  (**bold**, [links]) renders literally. Idempotent. */
export function normalizeMdxBlocks(src: string): string {
  // A one-line block component would otherwise sit inside a Markdown paragraph,
  // rendering a <div> inside a <p> (invalid HTML that breaks hydration). Give it
  // block form so its text is parsed as Markdown inside the component.
  // Nested one-liners (`<CardGroup><Card>x</Card></CardGroup>`) expand level by level.
  const expand = (line: string): string[] => {
    const match = ONE_LINE_BLOCK.exec(line);
    if (!match) return [line];
    const [, indent = '', tag = '', attributes = '', body = ''] = match;
    // Siblings of the same tag on one line (`<Card>a</Card><Card>b</Card>`) would be
    // mis-split by the greedy match; leave those lines as authored.
    if (body.toLowerCase().includes(`</${tag.toLowerCase()}>`)) return [line];
    return [`${indent}<${tag}${attributes}>`, '', ...expand(body.trim()), '', `${indent}</${tag}>`];
  };
  // Code samples are never rewritten: every step below skips fenced lines.
  const authoredSource = src.split('\n');
  const source = stripMdxComments(authoredSource, fencedMarkdownLines(authoredSource));
  const { lines: authored, fenced: authoredFences } = joinMultilineOpeners(source, fencedMarkdownLines(source));
  const lines = authored.flatMap((line, index) => (authoredFences[index] ? [line] : expand(line)));
  const fenced = fencedMarkdownLines(lines);
  const out: string[] = [];
  const outFenced: boolean[] = [];
  const push = (line: string, inCode = false) => {
    out.push(line);
    outFenced.push(inCode);
  };
  for (let i = 0; i < lines.length; i++) {
    const authoredLine = lines[i] ?? '';
    if (fenced[i]) {
      push(authoredLine, true);
      continue;
    }
    // Indentation is visual authoring syntax, not a request to turn component
    // tags into CommonMark code blocks.
    const line = COMPONENT_LINE.test(authoredLine) ? authoredLine.trim() : authoredLine;
    if (OPEN_TAG.test(line)) {
      push(line);
      const next = lines[i + 1];
      if (next !== undefined && next.trim() !== '') {
        push('');
      }
    } else if (CLOSE_TAG.test(line)) {
      const prev = out[out.length - 1];
      if (prev !== undefined && prev.trim() !== '') {
        push('');
      }
      push(line);
    } else {
      push(line);
    }
  }
  // Expand self-closing tags and rename HTML-colliding ones (see readerTagRewriter).
  const rename = rewriteReaderTags;
  // Rename outside inline code spans only, so component reference pages keep their examples.
  const prose = (text: string) => {
    let output = '';
    let cursor = 0;
    for (const match of text.matchAll(INLINE_CODE)) {
      output += rename(text.slice(cursor, match.index)) + match[0];
      cursor = match.index + match[0].length;
    }
    return output + rename(text.slice(cursor));
  };
  // Renames apply to runs of prose only (a tag may span lines), never inside code.
  const segments: string[] = [];
  let start = 0;
  for (let index = 1; index <= out.length; index += 1) {
    if (index === out.length || outFenced[index] !== outFenced[start]) {
      const text = out.slice(start, index).join('\n');
      segments.push(outFenced[start] ? text : prose(text));
      start = index;
    }
  }
  return segments.join('\n');
}
