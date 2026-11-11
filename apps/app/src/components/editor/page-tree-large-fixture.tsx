import type { PageNode } from '@/hooks/api';
import { PageTreeDndProvider, SortablePageTree } from './sortable-page-tree';

/** A 313-page site: one English group holding 120 pages, and 192 Arabic pages. */
export const largeTreePages = (): PageNode[] =>
  Array.from({ length: 313 }, (_, i) => ({
    id: `page-${i}`,
    title: `Page ${i}`,
    slug: `page-${i}`,
    path: `page-${i}`,
    parentId: i > 0 && i <= 120 ? 'page-0' : null,
    languageId: i <= 120 ? 'en' : 'ar',
    position: i,
    kind: i === 0 ? 'GROUP' : 'PAGE',
    icon: null,
    description: null,
    hidden: false,
    updatedAt: '',
  })) as PageNode[];

/** Both language trees of the large site, with the English group collapsed by the caller. */
export function LargeTree({ pages, onAction }: { pages: PageNode[]; onAction: () => void }) {
  return (
    <PageTreeDndProvider
      pages={pages}
      languages={[
        { id: 'en', label: 'English', collapsed: false },
        { id: 'ar', label: 'Arabic', collapsed: true },
      ]}
      dir="ltr"
      onMove={onAction}
    >
      <SortablePageTree languageId="en" activeId={null} onSelect={onAction} onAddChild={onAction} onSettings={onAction} />
      <SortablePageTree languageId="ar" activeId={null} onSelect={onAction} onAddChild={onAction} onSettings={onAction} />
    </PageTreeDndProvider>
  );
}
