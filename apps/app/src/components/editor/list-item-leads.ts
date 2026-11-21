import type { Fragment, Node as PMNode } from '@tiptap/pm/model';

/*
 * The editor's list item starts with a paragraph. An item whose first block is a
 * quote, a heading or a nested list (`- > a`, `- # a`, `- - a`) had none, so on load
 * that block was moved out of its list, and the page saved with an empty marker and
 * the block after it (#604, #865).
 *
 * Such an item now gets an empty paragraph before its first block on load (its
 * lead), and the serializer leaves an empty first paragraph out before those blocks,
 * so the block opens on the marker's line again. Nothing marks the lead: an item's
 * empty first paragraph before one of these blocks is always written this way, so
 * an edit, a split, undo or a paste leaves nothing to keep in step. A fence that
 * opens its item has its own lead (fence-source.ts).
 */

interface MarkdownToken {
  type: string;
  tag: string;
  level: number;
  block: boolean;
  hidden: boolean;
  content: string;
  map: [number, number] | null;
  children: MarkdownToken[] | null;
  meta: unknown;
}

interface MarkdownBlockState<T extends MarkdownToken> {
  tokens: T[];
  Token: new (type: string, tag: string, nesting: 1 | 0 | -1) => T;
}

interface MarkdownBlockParser {
  tokenize(state: MarkdownBlockState<MarkdownToken>, startLine: number, endLine: number): void;
}

/** The first blocks of a list item that get a lead, as markdown-it opens them. */
const LEAD_BLOCKS: ReadonlySet<string> = new Set(['blockquote_open', 'heading_open', 'bullet_list_open', 'ordered_list_open']);

/** The marker on a lead's `paragraph_open` token. */
const LEAD = 'nibleafListItemLead';

/** Whether a markdown-it token opens a list item's lead paragraph. */
export const isLeadToken = (token: { meta: unknown }): boolean => typeof token.meta === 'object' && token.meta !== null && LEAD in token.meta;

const leaded = new WeakSet<object>();

/**
 * Give each list item whose first block is in `LEAD_BLOCKS` an empty paragraph
 * before it. markdown-it's list rule tokenizes each item's content, then hides the
 * paragraphs of a tight list (`markTightParagraphs`). The lead goes in between, so a
 * tight list hides it too and its `hidden` flag says, as markdown-it read it, whether
 * the list is tight (tight-lists.ts reads it and shows the lead again).
 */
export function leadListItems(md: { block: MarkdownBlockParser }): void {
  const { block } = md;
  if (leaded.has(block)) return;
  leaded.add(block);
  const tokenize = block.tokenize;
  block.tokenize = function tokenizeWithLeads(state, startLine, endLine) {
    const at = state.tokens.length;
    tokenize.call(this, state, startLine, endLine);
    const first = state.tokens[at];
    if (state.tokens[at - 1]?.type !== 'list_item_open' || !first || !LEAD_BLOCKS.has(first.type)) return;
    const open = new state.Token('paragraph_open', 'p', 1);
    const inline = new state.Token('inline', '', 0);
    const close = new state.Token('paragraph_close', 'p', -1);
    for (const [offset, token] of [open, inline, close].entries()) {
      token.map = first.map;
      token.block = true;
      token.level = first.level + (offset === 1 ? 1 : 0);
    }
    open.meta = { [LEAD]: true };
    inline.content = '';
    inline.children = [];
    state.tokens.splice(at, 0, open, inline, close);
  };
}

/** The editor's blocks that markdown-it's `LEAD_BLOCKS` load as: a GitHub alert (`> [!NOTE]`)
 *  loads as a callout, and a list of task items as a task list. */
const LINE_BLOCKS: ReadonlySet<string> = new Set(['blockquote', 'heading', 'bulletList', 'orderedList', 'taskList', 'callout']);

/** Whether `node` opens a list item's line after its lead. A callout written as a component
 *  (`<Note>`) is an HTML block, which has no lead. */
const opensItemLine = (node: PMNode): boolean =>
  LINE_BLOCKS.has(node.type.name) && !(node.type.name === 'callout' && String(node.attrs.sourceOpen ?? '') !== '');

const isEmptyParagraph = (node: PMNode): boolean => node.type.name === 'paragraph' && node.content.size === 0;

/**
 * The block that opens a list item's line after its lead: the item's first block that is
 * not an empty paragraph, when every block before it is one (at least one) and it is in
 * `LINE_BLOCKS`. An edit can leave more than one empty paragraph there (Enter in an
 * emptied nested item); none of them can be written before the block, so all are left out.
 */
export function itemLineBlock(item: PMNode): { block: PMNode; index: number } | null {
  if (item.type.name !== 'listItem') return null;
  for (let index = 1; index < item.childCount; index++) {
    const child = item.child(index);
    if (!isEmptyParagraph(child)) return isEmptyParagraph(item.child(0)) && opensItemLine(child) ? { block: child, index } : null;
  }
  return null;
}

/** Whether `node` is one of a list item's empty first paragraphs before a block that then opens the item's line. */
export const isItemLead = (node: PMNode, parent: PMNode | Fragment | undefined, index: number | undefined): boolean =>
  index !== undefined && isEmptyParagraph(node) && !!parent && 'type' in parent && (itemLineBlock(parent)?.index ?? 0) > index;
