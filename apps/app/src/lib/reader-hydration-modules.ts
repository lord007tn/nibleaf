import { fencedMarkdownLines } from '@nibleaf/shared/markdown-code';
import type { LanguageFn } from 'highlight.js';
import type { LazyHighlightLanguage } from '@/lib/highlight-languages';
import { HYDRATION_MODULE_ATTRIBUTE, type HydrationModule, hydrationModule, loadServerRenderedModules } from '@/lib/hydration-modules';

/*
 * The reader's code-split renderers whose markup is server-rendered. The router
 * loads the ones a page was rendered with before hydrating, and the reader's
 * loaders load an article's renderers before navigating to it. Each one's
 * `HydrationIsland` carries its marker. It loads with the reader's page code,
 * so keep it to these declarations.
 */

/** Raw HTML/MDX and math need parse5/KaTeX; ordinary Markdown does not. Keep
 * detection conservative—false positives only load the richer renderer, while
 * false negatives could change output. Code (fenced blocks and inline spans)
 * can't hold raw HTML or math, so a `<div>` or `$HOME` in a code sample
 * doesn't count. */
export const needsRichMarkdown = (content: string): boolean => {
  const prose = withoutCode(content);
  return /<\/?[A-Za-z][^>]*>/.test(prose) || /(^|[^\\])\$\$?[\s\S]*?\$\$?/m.test(prose);
};

/** Fenced code lines blanked, as the reader's MDX normalizer sees them
 *  (`fencedMarkdownLines`), and single-line inline code spans. Indented code
 *  blocks and multi-line spans stay, so they can only cause false positives. */
const withoutCode = (content: string): string => {
  if (typeof content !== 'string') return '';
  if (!content.includes('`') && !content.includes('~~~')) return content;
  // A fence inside a blockquote or list ends where its container does, which a
  // line scan can't see: blanking from there could hide math or HTML after it.
  // When unsure, keep everything, so the check errs towards the rich renderer.
  if (CONTAINER_FENCE.test(content)) return content;
  const lines = content.split('\n');
  const fenced = fencedMarkdownLines(lines);
  return lines.map((line, index) => (fenced[index] ? '' : line.replace(INLINE_CODE, ''))).join('\n');
};

/** A backtick run that isn't escaped, its text on the same line, and a closing
 *  run of the same length. */
const INLINE_CODE = /(?<![\\`])(`+)[^`\n]+?\1(?!`)/g;
/** A fence opened inside a blockquote or list item. */
const CONTAINER_FENCE = /^[ \t]*(?:>|[-*+][ \t]|\d{1,9}[.)][ \t])[ \t>]*(?:`{3,}|~{3,})/m;

/** The article renderer (Markdown, GFM, code highlighting): pages with an
 *  article, not the API reference or a not-found page. */
export const articleMarkdownModule = hydrationModule('markdown', () => import('@/components/markdown').then((module) => module.Markdown));

/** Raw HTML/MDX components and math (parse5, KaTeX): only pages that use them.
 *  It loads through the article renderer, which it builds on: its preload list
 *  then stays in that chunk, out of every page's first load. */
export const richMarkdownModule = hydrationModule('markdown-rich', () => import('@/components/markdown').then((module) => module.loadRichMarkdown()));

const HIGHLIGHT_KEY_PREFIX = 'hljs-';
const highlightModules = new Map<string, HydrationModule<Record<string, LanguageFn>>>();

/** A highlight.js grammar outside the article renderer's core set (and the
 *  grammars it embeds): only articles with code in that language load it. */
export const highlightLanguageModule = (name: LazyHighlightLanguage): HydrationModule<Record<string, LanguageFn>> => {
  let module = highlightModules.get(name);
  if (!module) {
    module = hydrationModule(`${HIGHLIGHT_KEY_PREFIX}${name}`, () =>
      import('@/components/site/highlight-grammars').then((grammars) => grammars.loadHighlightGrammars(name)),
    );
    highlightModules.set(name, module);
  }
  return module;
};

/** Loads the renderers an article needs before it renders, so navigating to it
 *  never shows a fallback first. Never rejects: a failed download is left to
 *  the article's island, which retries and says so inline (not the route's
 *  error page). */
export const loadArticleRenderer = async (content: string): Promise<void> => {
  const grammars = import('@/lib/highlight-languages')
    .then((languages) => Promise.all(languages.lazyHighlightLanguages(content).map((name) => highlightLanguageModule(name).load())))
    .catch(() => undefined);
  await Promise.all([
    ...[articleMarkdownModule, ...(needsRichMarkdown(content) ? [richMarkdownModule] : [])].map((module) => module.load().catch(() => undefined)),
    grammars,
  ]);
};

/** Loads the reader modules whose markup is in the server HTML under `root`
 *  (the router's `hydrate` hook). */
export const loadServerRenderedReaderModules = (root: ParentNode) => {
  const languages = new Set<string>();
  for (const node of root.querySelectorAll(`[${HYDRATION_MODULE_ATTRIBUTE}]`)) {
    for (const key of node.getAttribute(HYDRATION_MODULE_ATTRIBUTE)?.split(/\s+/) ?? []) {
      if (key.startsWith(HIGHLIGHT_KEY_PREFIX)) languages.add(key.slice(HIGHLIGHT_KEY_PREFIX.length));
    }
  }
  // Keys come from the server's own markup, and only name lazy languages.
  const grammars = [...languages].map((name) => highlightLanguageModule(name as LazyHighlightLanguage));
  return loadServerRenderedModules(root, [articleMarkdownModule, richMarkdownModule, ...grammars]);
};
