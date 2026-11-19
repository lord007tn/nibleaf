import type { Node as PMNode } from '@tiptap/pm/model';
import { ITEM_LEAD_ATTRIBUTE, isListNode, MARKER_LINE_BLOCKS, opensWithBareMarker } from './list-item-leads';

/*
 * A list saves tight (no blank lines between its items) when its `tight` attribute
 * is set. tiptap-markdown sets it when the list holds no `<p>` at any depth, so a
 * tight list holding a loose list (whose paragraphs are shown) read as loose, and
 * its items were saved with blank lines between them on the first save (#638).
 * Such a list is now read as markdown-it reads it (`markTightLists`), when the
 * serializer writes its items back without blank lines.
 *
 * The attribute is set when a page loads, and edits can outgrow it: text typed into
 * an item's empty first paragraph now stands before the block that had the marker's
 * line. `writesTight` checks the list as it is when it is saved (#604).
 */

/** Whether the item's lead, now holding text, stands before a block it needs a gap from. */
function itemWritesTight(item: PMNode): boolean {
  for (let index = 1; index < item.childCount; index++) {
    const previous = item.child(index - 1);
    if (previous.type.name !== 'paragraph' || previous.content.size === 0) continue;
    const block = item.child(index);
    // A marker with nothing after it, under text, turns the text into a heading.
    if (isListNode(block) && opensWithBareMarker(block)) return false;
    if (!previous.attrs.sourceItemLead) continue;
    if (isListNode(block) && opensWithBareMarker(block, true)) return false;
    if (MARKER_LINE_BLOCKS.has(block.type.name)) return false;
    // CommonMark lets an ordered list interrupt a paragraph only from 1.
    if (block.type.name === 'orderedList' && Number(block.attrs.start ?? 1) !== 1) return false;
  }
  return true;
}

/**
 * Whether a list marked tight still saves tight. Text typed into an item's lead now
 * stands before the block that had the marker's line. A quote or heading then gets a
 * blank line, which makes the whole list loose on the next load, and a list numbered
 * from anything but 1 needs one, or it reads as more of the text. Such a list saves
 * loose at once. Lists without a lead keep the spacing they were read with.
 */
export function writesTight(list: PMNode): boolean {
  if (!list.attrs.tight) return false;
  let tight = true;
  list.forEach((item) => {
    tight &&= itemWritesTight(item);
  });
  return tight;
}

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
  if (token.type === 'paragraph_open') return token.attrGet(ITEM_LEAD_ATTRIBUTE) ? 'lead' : 'paragraph';
  if (token.type === 'fence') return 'fence';
  return LIST_OPEN.has(token.type) ? 'list' : 'other';
}

/**
 * A markdown-it core rule, run after the block rules and before the paragraph
 * source rule shows any hidden paragraph (paragraph-source.ts). markdown-it hides
 * the paragraphs of its items exactly when it reads a list as tight. Such a list is
 * marked tight (`data-tight`, which tiptap-markdown reads before looking for a
 * `<p>`) when the serializer writes every item's blocks back on consecutive lines:
 * each item starts with a paragraph or a block's schema lead (fence-source.ts),
 * followed only by blocks that can share its spacing. A quote followed by another
 * paragraph must stay loose, or that paragraph becomes the quote's lazy continuation.
 * A list with only leads has no paragraph whose hidden flag gives its spacing, so
 * the source gap between its items decides whether it is tight.
 */
export function markTightLists<T extends MarkdownToken>(state: MarkdownCoreState<T>): void {
  const original: T[] = [];
  let staged = false;
  for (let index = 0; index < state.tokens.length; index++) {
    const token = state.tokens[index] as T;
    if (token.type === 'paragraph_open' && token.attrGet(ITEM_LEAD_ATTRIBUTE)) {
      staged = true;
      index += 2;
    } else original.push(token);
  }
  if (staged) {
    writeTightLists({ ...state, tokens: original });
    for (const token of original) {
      if (LIST_OPEN.has(token.type)) token.attrSet('data-md-item-main-tight', token.attrGet('data-tight') ?? 'false');
    }
  }
  writeTightLists(state);
}

function writeTightLists<T extends MarkdownToken>(state: MarkdownCoreState<T>): void {
  const { tokens } = state;
  const lines = state.src.split('\n');
  /** Open lists, innermost last: whether they hold a paragraph with text of their
   *  own items, whether markdown-it hid them all, whether every item's blocks are
   *  written tight, whether its items fit the schema (start with a paragraph), and
   *  the block before in the item open now (null at its start). */
  const lists: Array<{
    token: T;
    paragraphs: boolean;
    hidden: boolean;
    tight: boolean;
    safe: boolean;
    previous: ItemBlock | null;
    lead: boolean;
    blank: boolean;
    end: number;
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
          (block === 'list' && list.previous !== 'list') ||
          (block === 'fence' && list.previous === 'paragraph' && tokens[index - 2]?.content === '');
      list.previous = block;
      if (block === 'paragraph' && (tokens[index + 1]?.content ?? '') !== '') {
        list.paragraphs = true;
        list.hidden &&= token.hidden;
      }
    }
    if (LIST_OPEN.has(token.type))
      lists.push({ token, paragraphs: false, hidden: true, tight: true, safe: true, previous: null, lead: false, blank: false, end: -1 });
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
