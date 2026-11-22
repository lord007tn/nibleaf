/*
 * A list saves tight (no blank lines between its items) when its `tight` attribute
 * is set. tiptap-markdown sets it when the list holds no `<p>` at any depth, so a
 * tight list holding a loose list (whose paragraphs are shown) read as loose, and
 * its items were saved with blank lines between them on the first save (#638).
 * Such a list is now read as markdown-it reads it (`markTightLists`), when the
 * serializer writes its items back without blank lines.
 */

import type { Node as PMNode } from '@tiptap/pm/model';
import { isLeadToken, itemLineBlock } from './list-item-leads';

interface MarkdownToken {
  type: string;
  level: number;
  nesting: number;
  content: string;
  hidden: boolean;
  map: [number, number] | null;
  meta: unknown;
  attrSet(name: string, value: string): void;
}

interface MarkdownCoreState<T extends MarkdownToken> {
  src: string;
  tokens: T[];
}

const LIST_OPEN = new Set(['bullet_list_open', 'ordered_list_open']);
const LIST_CLOSE = new Set(['bullet_list_close', 'ordered_list_close']);

/** A block straight inside a list item, as the serializer joins it to the one before. */
type ItemBlock = 'lead' | 'paragraph' | 'fence' | 'line' | 'bullet_list_open' | 'ordered_list_open' | 'other';

function itemBlock(token: MarkdownToken): ItemBlock {
  if (token.type === 'paragraph_open') return isLeadToken(token) ? 'lead' : 'paragraph';
  if (token.type === 'fence') return 'fence';
  // A quote or heading, which a nested list can follow on the next line.
  if (token.type === 'blockquote_open' || token.type === 'heading_open') return 'line';
  return token.type === 'bullet_list_open' || token.type === 'ordered_list_open' ? token.type : 'other';
}

const isList = (block: ItemBlock | null) => block === 'bullet_list_open' || block === 'ordered_list_open';

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
  let sourceLines: string[] | undefined;
  /** Open lists, innermost last: whether they hold a paragraph with text of their
   *  own items, whether markdown-it hid them all, whether every item's blocks are
   *  written tight, whether its items fit the schema (start with a paragraph), and
   *  the block before in the item open now (null at its start). */
  const lists: Array<{ token: T; paragraphs: boolean; hidden: boolean; tight: boolean; safe: boolean; previous: ItemBlock | null }> = [];
  for (const [index, token] of tokens.entries()) {
    const list = lists[lists.length - 1];
    if (list && token.level === list.token.level + 1 && token.type === 'list_item_open') list.previous = null;
    if (list && token.level === list.token.level + 2 && token.nesting !== -1) {
      const block = itemBlock(token);
      if (list.previous === null) {
        const inline = tokens[index + 1];
        // Restore the trimmed separator of a standalone empty task. Neighboring
        // items or child blocks can require the existing list schema fitting.
        if (
          list.token.type === 'bullet_list_open' &&
          tokens[index - 2] === list.token &&
          block === 'paragraph' &&
          inline?.type === 'inline' &&
          inline.map &&
          /^\[[ xX]\]$/.test(inline.content) &&
          tokens[index + 3]?.type === 'list_item_close' &&
          tokens[index + 4]?.type === 'bullet_list_close'
        ) {
          sourceLines ??= state.src.split('\n');
          if (/[ \t]$/.test(sourceLines[inline.map[0]] ?? '')) inline.content += ' ';
        }
        list.safe &&= block === 'paragraph' || block === 'lead';
        list.tight &&= block === 'paragraph' || block === 'lead';
      }
      // A block after a lead opens on the item's first line (list-item-leads.ts), as a
      // fence after a lead paragraph does (fence-source.ts).
      else if (list.previous !== 'lead')
        list.tight &&=
          // A list after a list of its own type is written after blank lines (markdown-output.ts).
          (isList(block) && list.previous !== 'other' && list.previous !== block) ||
          (block === 'fence' && list.previous === 'paragraph' && tokens[index - 2]?.content === '');
      list.previous = block;
      if (block === 'paragraph' && (tokens[index + 1]?.content ?? '') !== '') {
        list.paragraphs = true;
        list.hidden &&= token.hidden;
      }
      // markdown-it hid a lead exactly when it read its list as tight. The lead is
      // shown, so the item keeps it, and the list's spacing is read from it instead.
      if (block === 'lead') {
        list.paragraphs = true;
        list.hidden &&= token.hidden;
        token.hidden = false;
        const close = tokens[index + 2];
        if (close) close.hidden = false;
      }
    }
    if (LIST_OPEN.has(token.type)) lists.push({ token, paragraphs: false, hidden: true, tight: true, safe: true, previous: null });
    if (list && LIST_CLOSE.has(token.type) && list.token.level === token.level) {
      lists.pop();
      if (list.paragraphs && list.hidden && list.tight) list.token.attrSet('data-tight', 'true');
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

const ITEMS: ReadonlySet<string> = new Set(['listItem', 'taskItem']);
const LIST_NODES: ReadonlySet<string> = new Set(['bulletList', 'orderedList', 'taskList']);
/** The blocks a nested list can be written straight after, on the next line. A heading
 *  and a fence (it has its closing line) end there. A quote, a callout or a list ends
 *  there only when the list can interrupt the text it ends with, which would otherwise
 *  take the list's first line as a lazy continuation. After anything else (an HTML
 *  block, a table) the list's first line would read as more of that block. */
const ENDS_ON_ITS_LINE: ReadonlySet<string> = new Set(['heading', 'codeBlock']);
const ENDS_WITH_TEXT: ReadonlySet<string> = new Set(['paragraph', 'blockquote', 'callout', ...LIST_NODES]);

/**
 * Whether a list nested straight after a paragraph's text starts a list there: an
 * ordered list that does not start at 1, or a list whose first item is empty, cannot
 * interrupt a paragraph, so it would read back as more of the paragraph's text.
 */
function interruptsParagraph(list: PMNode): boolean {
  const first = list.firstChild;
  if (list.type.name === 'orderedList' && Number(list.attrs.start ?? 1) !== 1) return false;
  return !!first && !(first.childCount === 1 && first.firstChild?.content.size === 0);
}

/**
 * Whether the serializer writes the blocks of `item` on consecutive lines, as a tight
 * list needs: its first block (an empty paragraph is left out before the paragraph,
 * fence or block that then opens the item's line), then only nested lists, each where
 * the line before lets a list start (`ENDS_ON_ITS_LINE`, `ENDS_WITH_TEXT`), and not
 * after a list of its own type (two such lists are written with blank lines between
 * them). Anything else is written after a blank line inside the item.
 */
function itemWritesTight(item: PMNode): boolean {
  let index = 1;
  let previous = item.firstChild as PMNode;
  const line = itemLineBlock(item);
  if (line) {
    // The block after its leads opens the item's line (list-item-leads.ts).
    index = line.index + 1;
    previous = line.block;
  } else if (previous.type.name === 'paragraph' && previous.content.size === 0 && item.childCount > 1) {
    const next = item.child(1);
    // The paragraph (paragraph-source.ts) or fence (fence-source.ts) after it opens the item's line.
    if (next.type.name === 'paragraph' || next.type.name === 'codeBlock') {
      index = 2;
      previous = next;
    }
  }
  for (; index < item.childCount; index++) {
    const child = item.child(index);
    if (!LIST_NODES.has(child.type.name)) return false;
    const name = previous.type.name;
    if (previous.type === child.type || (ENDS_WITH_TEXT.has(name) ? !interruptsParagraph(child) : !ENDS_ON_ITS_LINE.has(name))) return false;
    previous = child;
  }
  return true;
}

/**
 * Whether a list marked tight can be written tight. An edit can give an item a block
 * a tight list cannot hold on consecutive lines (text typed into a lead before a quote,
 * `- Typed` then `> a`): written with a blank line inside the item, the list read back
 * as loose, and the next save rewrote it again. Such a list is written loose.
 */
export function writesTight(list: PMNode): boolean {
  let tight = true;
  list.forEach((item) => {
    if (tight && ITEMS.has(item.type.name) && !itemWritesTight(item)) tight = false;
  });
  return tight;
}

/** The nodes a list can hold and still have no `<p>` once written (`readsBackTight`). */
const WITHOUT_PARAGRAPHS: ReadonlySet<string> = new Set([...ITEMS, ...LIST_NODES, 'codeBlock']);

/**
 * Whether a list reads back as tight whichever way it is written: tiptap-markdown reads a
 * list as tight when it holds no `<p>` at any depth, so a list of empty items and fences
 * (a pasted list, or one an edit emptied) never reads back loose. Written loose, its next
 * save rewrote it tight; and a tight one written loose because an item holds two fences
 * read back tight and was rewritten loose (corpus page 45). Such a list is written tight,
 * as main writes a list marked tight: a blank line inside an item reads back the same.
 */
export function readsBackTight(list: PMNode): boolean {
  let text = false;
  list.descendants((node, _pos, parent) => {
    if (text) return false;
    const empty = node.type.name === 'paragraph' && node.content.size === 0 && !(parent && itemLineBlock(parent));
    text = !empty && !WITHOUT_PARAGRAPHS.has(node.type.name);
    return !text && node.type.name !== 'codeBlock';
  });
  return !text;
}
