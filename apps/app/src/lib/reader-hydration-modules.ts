import { hydrationModule, loadServerRenderedModules } from '@/lib/hydration-modules';

/*
 * The reader's code-split renderers whose markup is server-rendered. The router
 * loads the ones a page was rendered with before hydrating, and the reader's
 * loaders load an article's renderers before navigating to it. Each one's
 * `HydrationIsland` carries its marker. It loads with the reader's page code,
 * so keep it to these declarations.
 */

/** Raw HTML/MDX and math need parse5/KaTeX; ordinary Markdown does not. Keep
 * detection conservative—false positives only load the richer renderer, while
 * false negatives could change output. */
export const needsRichMarkdown = (content: string): boolean => /<\/?[A-Za-z][^>]*>/.test(content) || /(^|[^\\])\$\$?[\s\S]*?\$\$?/m.test(content);

/** The article renderer (Markdown, GFM, code highlighting): pages with an
 *  article, not the API reference or a not-found page. */
export const articleMarkdownModule = hydrationModule('markdown', () => import('@/components/markdown').then((module) => module.Markdown));

/** Raw HTML/MDX components and math (parse5, KaTeX): only pages that use them.
 *  It loads through the article renderer, which it builds on: its preload list
 *  then stays in that chunk, out of every page's first load. */
export const richMarkdownModule = hydrationModule('markdown-rich', () => import('@/components/markdown').then((module) => module.loadRichMarkdown()));

/** Loads the renderers an article needs before it renders, so navigating to it
 *  never shows a fallback first. Never rejects: a failed download is left to
 *  the article's island, which retries and says so inline (not the route's
 *  error page). */
export const loadArticleRenderer = async (content: string): Promise<void> => {
  await Promise.all(
    [articleMarkdownModule, ...(needsRichMarkdown(content) ? [richMarkdownModule] : [])].map((module) => module.load().catch(() => undefined)),
  );
};

/** Loads the reader modules whose markup is in the server HTML under `root`
 *  (the router's `hydrate` hook). */
export const loadServerRenderedReaderModules = (root: ParentNode) => loadServerRenderedModules(root, [articleMarkdownModule, richMarkdownModule]);
