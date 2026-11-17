/*
 * A list saves tight (no blank lines between its items) when its `tight` attribute
 * is set. tiptap-markdown sets it when the list holds no `<p>` at any depth, so a
 * tight list holding a loose list (whose paragraphs are shown) read as loose, and
 * its items were saved with blank lines between them on the first save (#638).
 * Such a list is now read as markdown-it reads it (`markTightLists`), when the
 * serializer writes its items back without blank lines.
 */

interface MarkdownToken {
  type: string;
  level: number;
  nesting: number;
  content: string;
  hidden: boolean;
  map: [number, number] | null;
  attrGet(name: string): string | null;
  attrSet(name: string, value: string): void;
}

interface MarkdownCoreState<T extends MarkdownToken> {
  src: string;
  tokens: T[];
}

const LIST_OPEN = new Set(['bullet_list_open', 'ordered_list_open']);
const LIST_CLOSE = new Set(['bullet_list_close', 'ordered_list_close']);

/** A block straight inside a list item, as the serializer joins it to the one before. */
type ItemBlock = 'paragraph' | 'lead' | 'fence' | 'list' | 'other';

function itemBlock(token: MarkdownToken): ItemBlock {
  if (token.type === 'paragraph_open') return token.attrGet('data-md-item-lead') ? 'lead' : 'paragraph';
  if (token.type === 'fence') return 'fence';
  return LIST_OPEN.has(token.type) ? 'list' : 'other';
}

/**
 * A markdown-it core rule, run after the block rules and before the paragraph
 * source rule shows any hidden paragraph (paragraph-source.ts). markdown-it hides
 * the paragraphs of its items exactly when it reads a list as tight. Such a list is
 * marked tight (`data-tight`, which tiptap-markdown reads before looking for a
 * `<p>`) when the serializer writes every item's blocks back on consecutive lines:
 * each item starts with a paragraph (or a fence's lead, fence-source.ts), and holds
 * nothing after it but nested lists, which prosemirror-markdown's `renderList`
 * writes straight after the line before in a tight list. A list holding a quote, a
 * fence after text, or anything else is left as tiptap-markdown reads it.
 */
export function markTightLists<T extends MarkdownToken>(state: MarkdownCoreState<T>): void {
  const { tokens } = state;
  const lines = state.src.split('\n');
  /** Open lists, innermost last: whether they hold a paragraph with text of their
   *  own items, whether markdown-it hid them all, whether every item's blocks are
   *  written tight, whether its items fit the schema (start with a paragraph), and
   *  the block before in the item open now (null at its start). */
  const lists: Array<{
    token: T; paragraphs: boolean; hidden: boolean; tight: boolean; safe: boolean; previous: ItemBlock | null;
    lead: boolean; blank: boolean; end: number;
  }> = [];
  for (const [index, token] of tokens.entries()) {
    const list = lists[lists.length - 1];
    if (list && token.level === list.token.level + 1 && token.type === 'list_item_open') {
      list.previous = null;
      for (let line = list.end; line >= 0 && line < (token.map?.[0] ?? 0) && !list.blank; line++) {
        list.blank = /^[ \t>]*$/.test(lines[line] ?? '');
      }
    }
    if (list && token.level === list.token.level + 2 && token.nesting !== -1) {
      const block = itemBlock(token);
      if (token.map) {
        let end = token.map[1];
        while (end > token.map[0] && /^[ \t>]*$/.test(lines[end - 1] ?? '')) end--;
        list.end = Math.max(list.end, end);
      }
      list.lead ||= block === 'lead';
      if (list.previous === null) {
        list.safe &&= block === 'paragraph' || block === 'lead';
        list.tight &&= block === 'paragraph' || block === 'lead';
      }
      // A fence after a lead paragraph opens on the item's first line (fence-source.ts).
      else
        list.tight &&=
          list.previous === 'lead' ||
          (block === 'list' && list.previous !== 'list') || (block === 'fence' && list.previous === 'paragraph' && tokens[index - 2]?.content === '');
      list.previous = block;
      if (block === 'paragraph' && (tokens[index + 1]?.content ?? '') !== '') {
        list.paragraphs = true;
        list.hidden &&= token.hidden;
      }
    }
    if (LIST_OPEN.has(token.type)) lists.push({ token, paragraphs: false, hidden: true, tight: true, safe: true, previous: null, lead: false, blank: false, end: -1 });
    if (list && LIST_CLOSE.has(token.type) && list.token.level === token.level) {
      lists.pop();
      if (list.tight && list.hidden && (list.paragraphs || (list.lead && !list.blank))) list.token.attrSet('data-tight', 'true');
      const parent = lists[lists.length - 1];
      if (parent) {
        // Schema fitting moves a quote-led item out after an empty list marker.
        // A tight ancestor can join that marker to its text as a setext heading.
        parent.tight &&= list.safe;
        parent.safe &&= list.safe;
      }
    }
  }
}
