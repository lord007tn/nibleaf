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
import remarkMath from 'remark-math';
// The renderer's math delimiters, read as its line-based check reads them.
import { containsMath, decodeNumericReferences, MATH_CLASS } from './reader-rich';

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

type ParseOptions = NonNullable<Parameters<typeof fromMarkdown>[1]>;

/** The math syntax the rich renderer parses with, taken from its own plugin:
 *  remark-math only registers its micromark and mdast extensions on the
 *  processor's data, so calling it on a data store yields exactly those. */
const MATH_SYNTAX = (() => {
  const data: { micromarkExtensions?: ParseOptions['extensions']; fromMarkdownExtensions?: ParseOptions['mdastExtensions'] } = {};
  (remarkMath as unknown as (this: { data: () => typeof data }) => void).call({ data: () => data });
  return { extensions: data.micromarkExtensions ?? [], mdastExtensions: data.fromMarkdownExtensions ?? [] };
})();

/** Whether a tree parsed with the math syntax holds inline or display math. */
const hasMathNode = (node: { type: string; children?: unknown[] }): boolean =>
  node.type === 'inlineMath' || node.type === 'math' || (node.children ?? []).some((child) => hasMathNode(child as typeof node));

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
      // Class names as the HTML parser reads them: `math&#45;inline` is math.
      const html = decodeNumericReferences(node.value);
      if (MATH_CLASS.test(html)) htmlMath = true;
      for (const [, language] of html.matchAll(CLASS_LANGUAGE)) if (language) languages.add(language.toLowerCase());
      return;
    }
    if (node.type === 'text') prose.push(node.value);
    if ('children' in node) for (const child of node.children as Nodes[]) visit(child);
  };
  visit(fromMarkdown(markdown, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] }));
  const isRich = rich || containsMath(prose.join('\n'));
  // Whether the page is rich is decided as before. Math only matters on a rich
  // page (the plain renderer has no math syntax), and there it is read with
  // remark-math's own syntax, as the rich renderer parses: plain Markdown can
  // hide a delimiter in what it reads as a code span, a link destination or an
  // attribute (`$\`x$\``), and resolves escapes (`\\$x$` is math).
  const syntaxMath =
    isRich &&
    markdown.includes('$') &&
    hasMathNode(
      fromMarkdown(markdown, {
        extensions: [gfm(), ...MATH_SYNTAX.extensions],
        mdastExtensions: [gfmFromMarkdown(), ...MATH_SYNTAX.mdastExtensions],
      }),
    );
  return { languages: [...languages].sort(), rich: isRich, math: syntaxMath || htmlMath || languages.has('math') };
};
