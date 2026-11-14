/**
 * What a Markdown document asks of the reader's renderer, read with the same
 * Markdown semantics the renderer parses with (micromark + GFM): the languages
 * of its code blocks, and whether it needs the rich renderer (raw HTML/MDX or
 * `$` math outside code).
 *
 * The parser handles what a line-based scan gets wrong: fences inside lists and
 * blockquotes (`- > ```rust`), fences a container closes (`> ````` then a blank
 * line), and character references in an info string (`r&#117;st`).
 *
 * It only runs inside the article renderer's chunk, which already carries these
 * parsing libraries, never in a page's first load.
 */
import type { Nodes } from 'mdast';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';
// The renderer's math delimiters, read as its line-based check reads them.
import { containsMath } from './reader-rich';

export interface MarkdownCodeUsage {
  /** Lower-cased code block languages, plus `language-*` classes in raw HTML. */
  languages: string[];
  /** Raw HTML/MDX, or `$…$` math outside code. */
  rich: boolean;
  /** `$…$` math outside code, or a ```math fence: the rich renderer then also
   *  loads KaTeX. So does raw HTML with a `math-inline`/`math-display` class.
   *  (A math fence alone doesn't make a page rich, as before.) */
  math: boolean;
}

/** micromark can go superlinear on long runs of emphasis, bracket and tag
 *  markers (#453). Past these bounds the caller falls back to its conservative
 *  line-based detection instead of parsing. */
const MAX_LENGTH = 400_000;
const MAX_MARKERS = 40_000;
const MARKERS = new Set(['*', '_', '[', ']', '<', '>']);

const CLASS_LANGUAGE = /\blang(?:uage)?-([^\s"'`>]+)/g;
/** The classes rehype-katex renders as math. */
const MATH_CLASS = /\bmath-(?:inline|display)\b/;

/** Null when the document is too large or marker-dense to parse safely. */
export const markdownCodeUsage = (markdown: string): MarkdownCodeUsage | null => {
  if (typeof markdown !== 'string') return { languages: [], rich: false, math: false };
  if (markdown.length > MAX_LENGTH) return null;
  let markers = 0;
  for (let index = 0; index < markdown.length; index += 1) {
    if (MARKERS.has(markdown[index] as string) && ++markers > MAX_MARKERS) return null;
  }
  const languages = new Set<string>();
  let rich = false;
  // Raw HTML that rehype-katex renders (`<code class="math-inline">`).
  let htmlMath = false;
  const prose: string[] = [];
  const visit = (node: Nodes) => {
    if (node.type === 'code') {
      if (node.lang) languages.add(node.lang.toLowerCase());
      return;
    }
    if (node.type === 'inlineCode') return;
    if (node.type === 'html') {
      rich = true;
      if (MATH_CLASS.test(node.value)) htmlMath = true;
      for (const [, language] of node.value.matchAll(CLASS_LANGUAGE)) if (language) languages.add(language.toLowerCase());
      return;
    }
    if (node.type === 'text') prose.push(node.value);
    if ('children' in node) for (const child of node.children as Nodes[]) visit(child);
  };
  visit(fromMarkdown(markdown, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] }));
  const inlineMath = containsMath(prose.join('\n'));
  return { languages: [...languages].sort(), rich: rich || inlineMath, math: inlineMath || htmlMath || languages.has('math') };
};
