import type { Node as PMNode } from '@tiptap/pm/model';

/*
 * A list saves tight (no blank lines between its items) when its `tight` attribute
 * is set, and a blank line anywhere between the blocks of a list's items makes
 * CommonMark read the whole list as loose. Two first-save rewrites came from the
 * two ends of that:
 *
 * - A tight item with a fence and text after it (`- Step:`, the fence, `After.`)
 *   was written with a blank line on each side of the fence, so the list saved
 *   loose (#605). In a tight list a fence and a paragraph next to it are now
 *   written on consecutive lines (`writeListItem`).
 * - tiptap-markdown reads a list as loose when it holds a `<p>` at any depth, so a
 *   tight list holding a loose list (whose paragraphs are shown) read as loose, and
 *   its items were saved with blank lines between them (#638). Such a list is now
 *   read as markdown-it reads it (`markTightLists`), when the serializer writes its
 *   items back without blank lines.
 */

/**
 * Whether two blocks of a tight list's item are written on consecutive lines: a
 * fence and a paragraph with text, either way round. A fence interrupts a
 * paragraph, and a paragraph after a closed fence starts a new block. An empty
 * paragraph (a fence's lead, fence-source.ts) is left as it is.
 */
function joinsTight(previous: PMNode, next: PMNode): boolean {
  const pair = [previous, next];
  const fence = pair.find((node) => node.type.name === 'codeBlock');
  const paragraph = pair.find((node) => node.type.name === 'paragraph');
  return Boolean(fence && paragraph && paragraph.content.size > 0);
}

/** The parts of prosemirror-markdown's serializer state a list item is written with. */
export interface ListItemSerializeState {
  inTightList: boolean;
  flushClose: (size?: number) => void;
  render: (node: PMNode, parent: PMNode, index: number) => void;
}

/**
 * Write a list item as tiptap-markdown does (prosemirror-markdown's `list_item`:
 * each block in turn), except that, in a tight list, a fence and a paragraph next
 * to it are written without a blank line between them (see `joinsTight`). The
 * editor's serializer uses it for `listItem` (markdown-output.ts).
 */
export function writeListItem(state: ListItemSerializeState, node: PMNode): void {
  node.forEach((child, _offset, index) => {
    const previous = index > 0 ? node.child(index - 1) : null;
    if (previous && state.inTightList && joinsTight(previous, child)) state.flushClose(1);
    state.render(child, node, index);
  });
}

interface MarkdownToken {
  type: string;
  level: number;
  nesting: number;
  content: string;
  hidden: boolean;
  attrSet(name: string, value: string): void;
}

interface MarkdownCoreState<T extends MarkdownToken> {
  tokens: T[];
}

const LIST_OPEN = new Set(['bullet_list_open', 'ordered_list_open']);
const LIST_CLOSE = new Set(['bullet_list_close', 'ordered_list_close']);

/** A block straight inside a list item, as the serializer joins it to the one before. */
type ItemBlock = 'paragraph' | 'fence' | 'list' | 'other';

/** Whether the serializer writes `next` straight after `previous` in a tight item,
 *  with no blank line: a nested list after a paragraph or a fence (prosemirror-
 *  markdown's `renderList`), and a fence and a paragraph next to each other. */
function tightPair(previous: ItemBlock, next: ItemBlock): boolean {
  if (next === 'list') return previous === 'paragraph' || previous === 'fence';
  return (previous === 'paragraph' && next === 'fence') || (previous === 'fence' && next === 'paragraph');
}

function itemBlock<T extends MarkdownToken>(tokens: readonly T[], index: number): ItemBlock {
  const token = tokens[index] as T;
  if (token.type === 'paragraph_open') return 'paragraph';
  if (token.type === 'fence') return 'fence';
  return LIST_OPEN.has(token.type) ? 'list' : 'other';
}

/**
 * A markdown-it core rule, run after the block rules and before the paragraph
 * source rule shows any hidden paragraph (paragraph-source.ts). markdown-it hides
 * the paragraphs of its items exactly when it reads a list as tight. Such a list is
 * marked tight (`data-tight`, which tiptap-markdown reads before looking for a
 * `<p>`) when the serializer writes every item's blocks back on consecutive lines:
 * each item starts with a paragraph, and its blocks pair as `tightPair` allows. A
 * list holding a quote, a table or anything else is left as tiptap-markdown reads it.
 */
export function markTightLists<T extends MarkdownToken>(state: MarkdownCoreState<T>): void {
  const { tokens } = state;
  /** Open lists, innermost last: whether they hold a paragraph with text of their
   *  own items, whether markdown-it hid them all, whether every item's blocks pair
   *  tight, and the block before in the item open now (null at its start). */
  const lists: Array<{ token: T; paragraphs: boolean; hidden: boolean; pairs: boolean; previous: ItemBlock | null }> = [];
  for (const [index, token] of tokens.entries()) {
    const list = lists[lists.length - 1];
    if (list && token.level === list.token.level + 1 && token.type === 'list_item_open') list.previous = null;
    if (list && token.level === list.token.level + 2 && token.nesting !== -1) {
      const block = itemBlock(tokens, index);
      const text = block === 'paragraph' && (tokens[index + 1]?.content ?? '') !== '';
      if (list.previous === null) list.pairs &&= block === 'paragraph';
      else list.pairs &&= tightPair(list.previous, block);
      list.previous = block;
      if (text) {
        list.paragraphs = true;
        list.hidden &&= token.hidden;
      }
    }
    if (LIST_OPEN.has(token.type)) lists.push({ token, paragraphs: false, hidden: true, pairs: true, previous: null });
    if (list && LIST_CLOSE.has(token.type) && list.token.level === token.level) {
      lists.pop();
      if (list.paragraphs && list.hidden && list.pairs) list.token.attrSet('data-tight', 'true');
    }
  }
}
