/**
 * The draft preview's navigation, as pure logic. It is the reader's tree
 * (`buildNavTree`) built from the draft pages, so the preview, the live site
 * and the editor's page tree all list pages in the author's order. Rendered by
 * `components/preview-nav.tsx`; tested in `preview-nav.test.ts`.
 */
import { buildNavTree, type NavNode, type NavSourcePage } from '@nibleaf/shared/site';

/** The draft page fields the preview's navigation reads (a dashboard `PageNode`). */
export interface DraftNavPage {
  id: string;
  parentId: string | null;
  kind: 'PAGE' | 'GROUP';
  title: string;
  slug: string;
  path: string;
  icon: string | null;
  position: number;
  hidden: boolean;
  config?: { sidebarTitle?: string; tag?: string; category?: string; categoryIcon?: string; categoryOrder?: number } | null;
}

/** A draft page in the shape navigation is built from. */
const navSourcePage = (page: DraftNavPage, languageCode: string): NavSourcePage => ({
  id: page.id,
  parentId: page.parentId,
  // The preview lists one language at a time; its code picks the "Untitled"
  // wording and the language of inferred category names.
  languageCode,
  kind: page.kind,
  title: page.title,
  slug: page.slug,
  path: page.path,
  icon: page.icon,
  config: page.config
    ? {
        sidebarTitle: page.config.sidebarTitle,
        tag: page.config.tag,
        category: page.config.category,
        categoryIcon: page.config.categoryIcon,
        categoryOrder: page.config.categoryOrder,
      }
    : null,
  position: page.position,
  hidden: page.hidden,
});

/** The previewed language's navigation, as readers will get it once published.
 *  Empty until the language is known: its pages are scoped to it, and an
 *  imported collection's category names are worded in it. */
export const previewNavTree = (pages: readonly DraftNavPage[] | undefined, languageCode: string | undefined): NavNode[] =>
  languageCode ? buildNavTree((pages ?? []).map((page) => navSourcePage(page, languageCode))) : [];

const firstNavPage = (nodes: readonly NavNode[]): string | undefined => {
  for (const node of nodes) {
    if (node.kind === 'PAGE') return node.id;
    const child = firstNavPage(node.children);
    if (child) return child;
  }
  return undefined;
};

/**
 * The page the preview opens on, chosen as the reader chooses this language's
 * home (`resolveSitePage` for the root): a visible page with an empty path
 * wins, otherwise the first page in nav order. Not covered: a translated site
 * root that sends readers to the default home's translation.
 */
export function previewHomeId(pages: readonly DraftNavPage[] | undefined, nodes: readonly NavNode[]): string | undefined {
  const visible = new Set(navOrderIds(nodes));
  const root = pages?.find((page) => page.kind === 'PAGE' && page.path === '' && visible.has(page.id));
  return root?.id ?? firstNavPage(nodes);
}

const navOrderIds = (nodes: readonly NavNode[]): string[] => nodes.flatMap((node) => [node.id, ...navOrderIds(node.children)]);
