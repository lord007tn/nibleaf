import { hydrationModule } from '@/lib/hydration-modules';

/*
 * The reader's code-split renderers whose markup is server-rendered. The router
 * loads the ones a page was rendered with before hydrating, and the reader's
 * loaders load an article's renderers before navigating to it. It loads with
 * the reader's page code, so keep it to these declarations.
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
 *  never shows a fallback first. A failed download is left to the renderer's
 *  own boundary. */
export const loadArticleRenderer = async (content: string): Promise<void> => {
  await Promise.all(
    [articleMarkdownModule, ...(needsRichMarkdown(content) ? [richMarkdownModule] : [])].map((module) => module.load().catch(() => undefined)),
  );
};

/** The Ask AI launcher and end-of-article card, with the chat's strings: only
 *  sites with the chat on. The loader hop keeps the chat's preload list out of
 *  the eager bundle (see load-chat-ui.ts). */
export const siteChatUiModule = hydrationModule('site-chat-ui', () =>
  import('@/components/site/ai-chat/load-chat-ui').then((loader) => loader.loadChatUi()),
);

/** Every reader module whose markup the server renders. */
export const readerHydrationModules = [articleMarkdownModule, richMarkdownModule, siteChatUiModule];
