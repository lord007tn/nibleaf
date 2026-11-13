/**
 * The draft preview's navigation, as pure logic. It is the reader's tree
 * (`buildNavTree`) built from the draft pages, so the preview, the live site
 * and the editor's page tree all list pages in the author's order. Rendered by
 * `components/preview-nav.tsx`; tested in `preview-nav.test.ts`.
 */
import { buildNavTree, type NavNode, type NavSourcePage } from '@nibleaf/shared/site';
import type { PageNode } from '@/hooks/api/types';

/** A draft page in the shape navigation is built from. */
export const navSourcePage = (page: PageNode, languageCode: string | undefined): NavSourcePage => ({
  id: page.id,
  parentId: page.parentId,
  // The preview lists one language at a time; its code only picks the "Untitled" wording.
  languageCode: languageCode ?? '',
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

/** The previewed language's navigation, exactly as readers will get it once published. */
export const previewNavTree = (pages: readonly PageNode[] | undefined, languageCode: string | undefined): NavNode[] =>
  buildNavTree((pages ?? []).map((page) => navSourcePage(page, languageCode)));

/** The page the preview opens on: the live site's home, the first page in nav order. */
export function previewHomeId(nodes: readonly NavNode[]): string | undefined {
  for (const node of nodes) {
    if (node.kind === 'PAGE') return node.id;
    const child = previewHomeId(node.children);
    if (child) return child;
  }
  return undefined;
}
