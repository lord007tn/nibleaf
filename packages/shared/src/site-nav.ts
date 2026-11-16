import type { NavNode } from './site';

/** Whether a navigation group leads to at least one page (an empty group is not shown). */
export const navGroupHasPage = (node: Pick<NavNode, 'kind' | 'children'>): boolean =>
  node.children.some((child) => child.kind === 'PAGE' || navGroupHasPage(child));

/** Whether a top-level page starts its own unlabelled block: it follows a shown
 *  group, so without a gap it would read as that group's last page. */
export const startsUngroupedBlock = (nodes: readonly NavNode[], index: number): boolean => {
  if (nodes[index]?.kind !== 'PAGE') return false;
  for (let previous = index - 1; previous >= 0; previous--) {
    const node = nodes[previous];
    if (!node) return false;
    if (node.kind === 'PAGE') return false;
    if (navGroupHasPage(node)) return true;
  }
  return false;
};
