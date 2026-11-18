import { commands as coreCommands, createDocument, type Editor, Extension } from '@tiptap/core';
import { isHistoryTransaction } from '@tiptap/pm/history';
import { DOMParser as PMDOMParser, type Node as PMNode, type Schema, Slice } from '@tiptap/pm/model';
import { AllSelection, Plugin, PluginKey, Selection, TextSelection, type Transaction } from '@tiptap/pm/state';
import {
  AddMarkStep,
  AddNodeMarkStep,
  AttrStep,
  DocAttrStep,
  RemoveMarkStep,
  RemoveNodeMarkStep,
  ReplaceAroundStep,
  ReplaceStep,
  type Step,
} from '@tiptap/pm/transform';
import type { MarkdownNodeSpec } from 'tiptap-markdown';

/*
 * The editor's list item must start with a paragraph, so a page's `- > Alpha` loses its
 * quote to schema fitting unless the item gets an empty paragraph first: its lead (#604,
 * #865). A lead is safe only while the document still is what the loader accepted, so:
 *
 * - The markdown-it rule stages a lead with a marker no page can write, and `fitItemLeads`
 *   keeps it only where one rule (`leadFormAllowed`) accepts it. The serializer uses the
 *   same rule, so it never writes a form the loader would refuse.
 * - Typing in a lead and Enter in a lead keep it. Any other edit that reaches a list with
 *   leads, or a neighbouring block, returns the whole page to what main loads for it
 *   (`returnToMainDocument`): before the edit, so it runs on main's own document, or right
 *   after it once a lead holds typed text or Enter has split one.
 * - Pasted and inserted Markdown never gets leads, and a copy holds none.
 */

type ItemLeadForm = 'inline' | 'block';

export const ITEM_LEAD_ATTRIBUTE = 'data-md-item-lead';

// Unknown to page content, so raw HTML in a page cannot pose as a staged lead.
const LEAD_TOKEN = Array.from(crypto.getRandomValues(new Uint32Array(4)), (part) => part.toString(36)).join('');

export const itemLeadMarker = (form: ItemLeadForm): string => `${LEAD_TOKEN}:${form}`;

export function itemLeadForm(marker: string | null | undefined): ItemLeadForm | undefined {
  if (marker === itemLeadMarker('inline')) return 'inline';
  return marker === itemLeadMarker('block') ? 'block' : undefined;
}

let stagingLeads = true;

/** Whether the Markdown being parsed may get leads. */
export const stagesItemLeads = (): boolean => stagingLeads;

/** Parse as main does, as all pasted and inserted Markdown is parsed. */
export function withoutItemLeads<T>(parse: () => T): T {
  const previous = stagingLeads;
  stagingLeads = false;
  try {
    return parse();
  } finally {
    stagingLeads = previous;
  }
}

const LIST_NODES: ReadonlySet<string> = new Set(['bulletList', 'orderedList']);
/** Blocks that can share a list marker's line, in place of an empty first paragraph. */
export const MARKER_LINE_BLOCKS: ReadonlySet<string> = new Set(['blockquote', 'heading']);

export const isListNode = (node: PMNode): boolean => LIST_NODES.has(node.type.name);
const isEmptyParagraph = (node: PMNode): boolean => node.type.name === 'paragraph' && node.content.size === 0;
const leadOf = (node: PMNode | null | undefined): ItemLeadForm | undefined =>
  node?.type.name === 'paragraph' ? node.attrs.sourceItemLead : undefined;

interface LeadFacts {
  ordered: boolean;
  listStart: number;
  /** The start number of the ordered list after the lead; null for any other block. */
  blockStart: number | null;
  laterItemsOpenWithLeads: boolean;
}

/**
 * The one rule for where a lead's block may be written. On the marker's line, an ordered
 * item needs every later item to open with a lead too, and a nested ordered list needs both
 * lists numbered from 1: anything else stays on main's path (it pins those pages' bytes).
 * On the line under a marker alone, the block stays in its item whatever follows.
 */
function leadFormAllowed(form: ItemLeadForm, facts: LeadFacts): boolean {
  if (form === 'block' || !facts.ordered) return true;
  if (facts.blockStart !== null && (facts.listStart !== 1 || facts.blockStart !== 1)) return false;
  return facts.laterItemsOpenWithLeads;
}

/** Whether the item opens with a kept lead before a quote, heading or list. */
function opensWithLead(item: PMNode): boolean {
  const first = item.firstChild;
  if (!first || !isEmptyParagraph(first) || !leadOf(first) || item.childCount < 2) return false;
  return MARKER_LINE_BLOCKS.has(item.child(1).type.name) || isListNode(item.child(1));
}

const lastItemsWithoutLead = new WeakMap<PMNode, number>();

function lastItemWithoutLead(list: PMNode): number {
  let last = lastItemsWithoutLead.get(list);
  if (last === undefined) {
    last = -1;
    for (let index = list.childCount - 1; index >= 0 && last < 0; index--) if (!opensWithLead(list.child(index))) last = index;
    lastItemsWithoutLead.set(list, last);
  }
  return last;
}

/**
 * Where a kept lead goes when its item is saved. `marker`: it is not written, and the block
 * takes the marker's line (`- > Alpha`). `above`: the marker stands alone, with the block on
 * the very next line; a blank line would end the item. Null: this is not a kept lead, and
 * the paragraph is written as main writes it.
 */
export function itemLeadPlacement(item: PMNode, list: PMNode, itemIndex: number): 'marker' | 'above' | null {
  if (item.type.name !== 'listItem' || !opensWithLead(item)) return null;
  const block = item.child(1);
  if (isListNode(block) && leadOf(item.child(0)) !== 'inline') return 'above';
  const allowed = leadFormAllowed('inline', {
    ordered: list.type.name === 'orderedList',
    listStart: Number(list.attrs.start ?? 1),
    blockStart: block.type.name === 'orderedList' ? Number(block.attrs.start ?? 1) : null,
    laterItemsOpenWithLeads: itemIndex >= lastItemWithoutLead(list),
  });
  return allowed ? 'marker' : 'above';
}

/** Whether this list's first line is a marker with nothing after it. Outside lead items
 *  (`anyItem` false) only a lead's marker counts, so other lists keep main's spacing. */
export function opensWithBareMarker(list: PMNode, anyItem = false): boolean {
  const item = list.firstChild;
  const first = item?.firstChild;
  if (!item || !first || !isEmptyParagraph(first) || (!anyItem && !leadOf(first))) return false;
  if (itemLeadPlacement(item, list, 0) !== 'marker') return true;
  const block = item.child(1);
  return isListNode(block) && opensWithBareMarker(block, anyItem);
}

const ITEM_CONTENT_NODES = new Set(['paragraph', 'text', 'hardBreak', 'listItem', 'blockquote', 'heading', 'bulletList', 'orderedList']);
const LEAD_SELECTOR = (['inline', 'block'] as const).map((form) => `li > p[${ITEM_LEAD_ATTRIBUTE}="${itemLeadMarker(form)}"]`).join(',');
const isLeadBlock = (node: PMNode | null | undefined): boolean => !!node && (MARKER_LINE_BLOCKS.has(node.type.name) || isListNode(node));

/** The outermost list `list` is nested in through list items alone. */
function outermostList(list: Element): Element {
  let root = list;
  while (root.parentElement?.tagName === 'LI' && root.parentElement.parentElement) root = root.parentElement.parentElement;
  return root;
}

/**
 * Keep a staged lead only where fitting would otherwise lift its block out, the list is
 * made of plain blocks (a token called a quote can be an HTML-backed callout by now), no
 * list of the same kind sits next to it, and `leadFormAllowed` accepts its form. One refused
 * lead sends its whole list tree to main's path, so a list is never half one and half the
 * other.
 */
function fitItemLeads(element: HTMLElement, schema: Schema): void {
  const parser = PMDOMParser.fromSchema(schema);
  const leads = Array.from(element.querySelectorAll(LEAD_SELECTOR));
  if (leads.length === 0) return;
  const candidates = new Set<Element | null>(leads.map((lead) => lead.parentElement));
  const tails = new Map<Element, boolean>();
  // Leads are visited backwards, so the items after this one are already known.
  const laterItemsOpenWithLeads = (item: Element): boolean => {
    const pending: Element[] = [];
    let result = true;
    for (let next = item.nextElementSibling; next; next = next.nextElementSibling) {
      const cached = tails.get(next);
      if (cached !== undefined) {
        result = cached;
        break;
      }
      pending.push(next);
      if (next.tagName === 'LI' && !next.firstElementChild?.matches(LEAD_SELECTOR.replaceAll('li > ', ''))) {
        result = false;
        break;
      }
    }
    for (const next of pending) tails.set(next, result);
    return result;
  };
  const withoutLeads = (root: Element): HTMLElement => {
    const clone = root.cloneNode(true) as HTMLElement;
    for (const staged of clone.querySelectorAll(LEAD_SELECTOR.replaceAll('li > ', ''))) staged.remove();
    return clone;
  };
  const simpleContents = new Map<Element, boolean>();
  const simpleContent = (root: Element): boolean => {
    const cached = simpleContents.get(root);
    if (cached !== undefined) return cached;
    let simple = true;
    parser.parseSlice(withoutLeads(root)).content.descendants((node) => {
      if (!ITEM_CONTENT_NODES.has(node.type.name)) simple = false;
      return simple;
    });
    simpleContents.set(root, simple);
    return simple;
  };
  const refused = new Set<Element>();
  for (const lead of leads.reverse()) {
    const item = lead.parentElement;
    const list = item?.parentElement;
    if (!item || !list) continue;
    const original = withoutLeads(item);
    const first = original.firstElementChild;
    const blockDOM = document.createElement('div');
    if (first) blockDOM.appendChild(first.cloneNode(true));
    const block = parser.parseSlice(blockDOM).content.firstChild;
    const listDOM = list.cloneNode(false) as HTMLElement;
    listDOM.appendChild(original);
    const holder = document.createElement('div');
    holder.appendChild(listDOM);
    let stayed = false;
    parser.parse(holder).firstChild?.firstChild?.forEach((child) => {
      if (block && child.eq(block)) stayed = true;
    });
    let safe =
      isLeadBlock(block) &&
      !stayed &&
      simpleContent(list) &&
      leadFormAllowed(itemLeadForm(lead.getAttribute(ITEM_LEAD_ATTRIBUTE)) ?? 'block', {
        ordered: list.tagName === 'OL',
        listStart: Number(list.getAttribute('start') ?? 1),
        blockStart: block?.type.name === 'orderedList' ? Number(block.attrs.start ?? 1) : null,
        laterItemsOpenWithLeads: laterItemsOpenWithLeads(item),
      });
    for (let ancestor: Element | null = item; ancestor && safe; ancestor = ancestor.parentElement) {
      if (candidates.has(ancestor) && !simpleContent(ancestor)) safe = false;
      // Same-kind neighbours merge on reload, which no placement can prevent.
      if (
        ancestor.matches('ul,ol') &&
        (ancestor.previousElementSibling?.tagName === ancestor.tagName || ancestor.nextElementSibling?.tagName === ancestor.tagName)
      )
        safe = false;
    }
    if (!safe) refused.add(outermostList(list));
  }
  const affected = new Set<Element>();
  for (const lead of element.querySelectorAll(LEAD_SELECTOR)) {
    const list = lead.parentElement?.parentElement;
    if (!list || !refused.has(outermostList(list))) continue;
    for (let ancestor: Element | null = list; ancestor; ancestor = ancestor.parentElement) if (ancestor.matches('ul,ol')) affected.add(ancestor);
    lead.remove();
  }
  for (const list of affected) {
    if (list.querySelector(LEAD_SELECTOR)) continue;
    if (list.getAttribute('data-md-item-main-tight') === 'true') list.setAttribute('data-tight', 'true');
    else list.removeAttribute('data-tight');
  }
}

interface LeadMarkdownStorage {
  parser: { parse(content: string, options?: { inline?: boolean }): string };
  serializer: { serialize(content: unknown): string };
  /** The Markdown the document was last set from, if it was set from Markdown. */
  loadedMarkdown: string | null;
  markContentReset(transaction: Transaction): void;
  isContentReset(transaction: Transaction): boolean;
}

const markdownOf = (editor: Editor) => (editor.storage as unknown as { markdown: LeadMarkdownStorage }).markdown;

function mainDocument(editor: Editor, markdown: string): PMNode {
  const html = withoutItemLeads(() => markdownOf(editor).parser.parse(markdown));
  return createDocument(html, editor.schema, editor.options.parseOptions) as PMNode;
}

/** How far the document has moved from what its Markdown loaded as. */
const UNTOUCHED = 0;
const INLINE_EDITS = 1;
const RESTRUCTURED = 2;
const leadGuardKey = new PluginKey<number>('listItemLeadGuard');

/** Whether no edit has touched the document since it loaded from its Markdown. */
const untouchedSinceLoad = (editor: Editor): boolean =>
  leadGuardKey.getState(editor.state) === UNTOUCHED && markdownOf(editor).loadedMarkdown !== null;

/** Whether an edit can run on the document main would hold. After Enter in a lead, or with
 *  text in one, main has no such document: the edit runs first, and the page then returns
 *  to main's reading of the result. */
function canReturnBeforeEdit(editor: Editor): boolean {
  const progress = leadGuardKey.getState(editor.state);
  if (progress === UNTOUCHED) return true;
  if (progress !== INLINE_EDITS) return false;
  let leadHoldsText = false;
  editor.state.doc.descendants((node) => {
    leadHoldsText ||= !!leadOf(node) && node.content.size > 0;
    return !leadHoldsText && !node.isTextblock;
  });
  return !leadHoldsText;
}

const nodesWithLeads = new WeakMap<PMNode, boolean>();

function holdsLead(node: PMNode): boolean {
  let holds = nodesWithLeads.get(node);
  if (holds === undefined) {
    holds = !!leadOf(node);
    if (!holds && !node.isTextblock)
      node.descendants((child) => {
        holds ||= !!leadOf(child);
        return !holds && !child.isTextblock;
      });
    nodesWithLeads.set(node, holds);
  }
  return holds;
}

/** Whether a list with leads lies in the top-level blocks of `from`..`to`, or right beside them. */
function rangeReachesLead(doc: PMNode, from: number, to: number): boolean {
  const start = doc.resolve(Math.min(from, doc.content.size)).index(0);
  const end = doc.resolve(Math.min(to, doc.content.size)).index(0);
  for (let index = Math.max(0, start - 1); index <= Math.min(doc.childCount - 1, end + 1); index++) if (holdsLead(doc.child(index))) return true;
  return false;
}

/** The textblock holding `position`, as its place among the document's textblocks. */
function textblockPlace(doc: PMNode, at: number): { index: number; offset: number } | null {
  // A position between blocks (the end of a page) counts as the nearest textblock's.
  const position = Selection.near(doc.resolve(at), -1).head;
  let index = 0;
  let place: { index: number; offset: number } | null = null;
  doc.descendants((node, at) => {
    if (place) return false;
    if (!node.isTextblock) return true;
    if (position >= at + 1 && position <= at + 1 + node.content.size) place = { index, offset: position - at - 1 };
    index++;
    return false;
  });
  return place;
}

function positionAt(doc: PMNode, place: { index: number; offset: number }): number | null {
  let index = 0;
  let position: number | null = null;
  doc.descendants((node, at) => {
    if (position !== null) return false;
    if (!node.isTextblock) return true;
    if (index++ === place.index) position = at + 1 + Math.min(place.offset, node.content.size);
    return false;
  });
  return position;
}

/**
 * Put the page into the state main loads it in: its current Markdown, read without leads.
 * Only the top-level blocks that differ are replaced, and the caret stays in its textblock.
 */
function returnToMainDocument(editor: Editor, transaction: Transaction, settle = false): void {
  const { doc, selection } = transaction;
  const storage = markdownOf(editor);
  const asLoaded = transaction.steps.length === 0 && transaction.doc === editor.state.doc && untouchedSinceLoad(editor);
  let markdown = asLoaded ? (storage.loadedMarkdown as string) : storage.serializer.serialize(doc);
  let main = mainDocument(editor, markdown);
  // After an edit no main document exists to match: read the result until it saves as read.
  for (let round = 0; settle && round < 4; round++) {
    const saved = storage.serializer.serialize(main);
    if (saved === markdown) break;
    markdown = saved;
    main = mainDocument(editor, markdown);
  }
  let next = main.content;
  // The editor's empty paragraph after the last block is in no Markdown: it stays.
  const trailing = doc.lastChild;
  if (trailing && isEmptyParagraph(trailing) && !(next.lastChild && isEmptyParagraph(next.lastChild))) next = next.addToEnd(trailing);
  const anchor = textblockPlace(doc, selection.anchor);
  const head = textblockPlace(doc, selection.head);
  let start = 0;
  let position = 0;
  while (start < doc.childCount && start < next.childCount && doc.child(start).eq(next.child(start))) position += doc.child(start++).nodeSize;
  let oldEnd = doc.childCount;
  let newEnd = next.childCount;
  while (oldEnd > start && newEnd > start && doc.child(oldEnd - 1).eq(next.child(newEnd - 1))) {
    oldEnd--;
    newEnd--;
  }
  let endPosition = position;
  for (let index = start; index < oldEnd; index++) endPosition += doc.child(index).nodeSize;
  const replacement: PMNode[] = [];
  for (let index = start; index < newEnd; index++) replacement.push(next.child(index));
  transaction.replaceWith(position, endPosition, replacement);
  const anchorAt = anchor && positionAt(transaction.doc, anchor);
  const headAt = head && positionAt(transaction.doc, head);
  let restored: Selection;
  if (selection instanceof AllSelection) restored = new AllSelection(transaction.doc);
  else if (typeof anchorAt === 'number' && typeof headAt === 'number') restored = TextSelection.create(transaction.doc, anchorAt, headAt);
  else restored = Selection.near(transaction.doc.resolve(Math.min(selection.from, transaction.doc.content.size)));
  transaction.setSelection(restored);
  transaction.setMeta(leadGuardKey, true);
  markdownOf(editor).markContentReset(transaction);
}

const selectionReachesLead = (doc: PMNode, selection: Selection): boolean => rangeReachesLead(doc, selection.from, selection.to);

/** Dispatch the return to main's document on its own, before an edit reads the state. */
function returnBeforeEdit(editor: Editor): void {
  const transaction = editor.state.tr;
  returnToMainDocument(editor, transaction);
  // Not an edit: if the key or paste then changes nothing, the page is not saved for it.
  editor.view.dispatch(transaction.setMeta('preventUpdate', true));
}

const DISTURBING_KEYS: ReadonlySet<string> = new Set(['Backspace', 'Delete', 'Tab', 'Ctrl-h', 'Ctrl-d']);

const inLeadParagraph = (selection: Selection): boolean => selection.empty && !!leadOf(selection.$from.parent);

/** Whether `key` (`Shift-Tab`, `Enter`) may change the structure around a lead. */
function keyDisturbsLead(editor: Editor, key: string): boolean {
  const { doc, selection } = editor.state;
  if (!selectionReachesLead(doc, selection) || !canReturnBeforeEdit(editor)) return false;
  if (key === 'Enter') return !inLeadParagraph(selection);
  const base = key.replace(/^(?:(?:Mod|Alt|Shift|Meta)-)+/, '');
  return DISTURBING_KEYS.has(key) || DISTURBING_KEYS.has(base);
}

function eventKeyName(event: KeyboardEvent): string {
  if (event.ctrlKey && !event.metaKey && !event.altKey && (event.key === 'h' || event.key === 'd')) return `Ctrl-${event.key}`;
  return event.key;
}

/** Whether a step only changes inline content or marks, or attributes outside any list. */
function leavesStructure(step: Step, doc: PMNode): boolean {
  if (step instanceof AddMarkStep || step instanceof RemoveMarkStep || step instanceof AddNodeMarkStep || step instanceof RemoveNodeMarkStep)
    return true;
  if (step instanceof DocAttrStep) return true;
  if (step instanceof AttrStep) {
    const node = doc.nodeAt(step.pos);
    return !!node && !isListNode(node) && node.type.name !== 'listItem';
  }
  if (step instanceof ReplaceStep) {
    // setNodeMarkup on a leaf (a component's attributes): the same leaf again.
    const replaced = doc.nodeAt(step.from);
    const leaf = step.slice.content.firstChild;
    if (
      replaced?.isLeaf &&
      !replaced.isText &&
      leaf?.type === replaced.type &&
      step.slice.content.childCount === 1 &&
      step.to === step.from + replaced.nodeSize
    )
      return true;
    const $from = doc.resolve(step.from);
    if (!$from.parent.isTextblock || !$from.sameParent(doc.resolve(step.to))) return false;
    let inline = step.slice.openStart === 0 && step.slice.openEnd === 0;
    step.slice.content.forEach((node) => {
      inline &&= node.isInline;
    });
    return inline;
  }
  if (step instanceof ReplaceAroundStep) {
    // setNodeMarkup: the same node with other attributes.
    const node = doc.nodeAt(step.from);
    const replacement = step.slice.content.firstChild;
    return (
      !!node &&
      !!replacement &&
      step.slice.content.childCount === 1 &&
      replacement.type === node.type &&
      step.gapFrom === step.from + 1 &&
      step.gapTo === step.to - 1 &&
      !isListNode(node) &&
      node.type.name !== 'listItem'
    );
  }
  return false;
}

/** Whether every kept lead still opens a list item, away from a same-kind neighbour list. */
function leadsStillPlaced(doc: PMNode): boolean {
  let placed = true;
  doc.descendants((node, _position, parent, index) => {
    if (!placed) return false;
    if (leadOf(node) && (parent?.type.name !== 'listItem' || index !== 0)) placed = false;
    if (
      isListNode(node) &&
      parent &&
      holdsLead(node) &&
      (parent.maybeChild(index - 1)?.type === node.type || parent.maybeChild(index + 1)?.type === node.type)
    )
      placed = false;
    return placed && !node.isTextblock;
  });
  return placed;
}

/** Commands that restructure blocks: near a lead they run on main's document, as on main. */
const GUARDED_COMMANDS = [
  'toggleList',
  'sinkListItem',
  'liftListItem',
  'wrapInList',
  'setNode',
  'toggleNode',
  'wrapIn',
  'toggleWrap',
  'lift',
  'clearNodes',
  'splitBlock',
  'deleteSelection',
  'deleteRange',
  'deleteNode',
  'deleteCurrentNode',
  'createParagraphNear',
  'liftEmptyBlock',
];

/** Fit staged leads after every node's DOM conversion. */
export const ListItemLeadFitting = Extension.create({
  name: 'listItemLeadFitting',
  priority: -1,
  addCommands() {
    const commands = coreCommands as unknown as Record<string, (...args: unknown[]) => (props: CommandProps) => boolean>;
    const guarded = (name: string) => [
      name,
      (...args: unknown[]) =>
        (props: CommandProps) => {
          const { selection, doc } = props.tr;
          if (
            props.dispatch &&
            props.tr.steps.length === 0 &&
            canReturnBeforeEdit(props.editor) &&
            selectionReachesLead(doc, selection) &&
            !(name === 'splitBlock' && inLeadParagraph(selection))
          ) {
            returnToMainDocument(props.editor, props.tr);
            // The command's chainable state refreshes when its transaction is read.
            void props.state.tr;
          }
          return (commands[name] as (...commandArgs: unknown[]) => (commandProps: CommandProps) => boolean)(...args)(props);
        },
    ];
    return {
      ...Object.fromEntries(GUARDED_COMMANDS.map(guarded)),
      keyboardShortcut: (name: string) => (props: CommandProps) => {
        if (props.dispatch && props.tr.steps.length === 0 && keyDisturbsLead(props.editor, name)) {
          // The key's handlers read the view's state, so it must change first.
          props.tr.setMeta('preventDispatch', true);
          returnBeforeEdit(props.editor);
          return props.editor.commands.keyboardShortcut(name);
        }
        return (commands.keyboardShortcut as (key: string) => (commandProps: CommandProps) => boolean)(name)(props);
      },
    } as never;
  },
  addStorage() {
    return {
      markdown: {
        parse: {
          updateDOM(element) {
            fitItemLeads(element, this.editor.schema);
          },
        },
      } satisfies Pick<MarkdownNodeSpec, 'parse'>,
    };
  },
});

interface CommandProps {
  editor: Editor;
  tr: Transaction;
  state: { tr: Transaction };
  dispatch?: unknown;
}

/** Keeps leads only while edits leave them provably in place (see the note at the top). */
export const ListItemLeadGuard = Extension.create({
  name: 'listItemLeadGuard',
  priority: 1000,
  addProseMirrorPlugins() {
    const { editor } = this;
    let enterInLead = false;
    const returnIfReached = () => {
      if (selectionReachesLead(editor.state.doc, editor.state.selection) && canReturnBeforeEdit(editor)) returnBeforeEdit(editor);
      return false;
    };
    return [
      new Plugin<number>({
        key: leadGuardKey,
        state: {
          init: () => UNTOUCHED,
          apply(transaction, progress) {
            if (transaction.getMeta(leadGuardKey)) return RESTRUCTURED;
            if (markdownOf(editor).isContentReset(transaction)) return UNTOUCHED;
            if (!transaction.docChanged || transaction.getMeta('appendedTransaction')) return progress;
            const inline = transaction.steps.every((step, index) => leavesStructure(step, transaction.docs[index] as PMNode));
            return Math.max(progress, inline ? INLINE_EDITS : RESTRUCTURED);
          },
        },
        props: {
          handleKeyDown(_view, event) {
            const key = eventKeyName(event);
            enterInLead = key === 'Enter' && !event.shiftKey && inLeadParagraph(editor.state.selection);
            // keyboardShortcut has already returned to main's document; it captures this run.
            if (!editor.isCapturingTransaction && keyDisturbsLead(editor, event.shiftKey && key === 'Enter' ? 'Shift-Enter' : key))
              returnBeforeEdit(editor);
            return false;
          },
          handleDOMEvents: {
            paste: returnIfReached,
            cut: returnIfReached,
            drop: () => {
              const { doc } = editor.state;
              if (rangeReachesLead(doc, 0, doc.content.size) && canReturnBeforeEdit(editor)) returnBeforeEdit(editor);
              return false;
            },
          },
          transformCopied(slice) {
            let leads = false;
            slice.content.descendants((node) => {
              leads ||= !!leadOf(node);
              return !leads;
            });
            return leads ? new Slice(mainDocument(editor, markdownOf(editor).serializer.serialize(slice.content)).content, 0, 0) : slice;
          },
        },
        appendTransaction(transactions, _oldState, newState) {
          const enter = enterInLead;
          enterInLead = false;
          const { doc } = newState;
          let reached = false;
          for (const transaction of transactions) {
            if (!transaction.docChanged || transaction.getMeta(leadGuardKey) || transaction.getMeta('appendedTransaction')) continue;
            if (isHistoryTransaction(transaction) || markdownOf(editor).isContentReset(transaction)) continue;
            transaction.steps.forEach((step, index) => {
              if (reached || leavesStructure(step, transaction.docs[index] as PMNode)) return;
              const after = transaction.mapping.slice(index + 1);
              const later = transactions.slice(transactions.indexOf(transaction) + 1);
              step.getMap().forEach((_oldStart, _oldEnd, newStart, newEnd) => {
                let from = after.map(newStart, -1);
                let to = after.map(newEnd, 1);
                for (const next of later) {
                  from = next.mapping.map(from, -1);
                  to = next.mapping.map(to, 1);
                }
                reached ||= rangeReachesLead(doc, from, to);
              });
            });
          }
          if (!reached || (enter && leadsStillPlaced(doc))) return null;
          const transaction = newState.tr;
          returnToMainDocument(editor, transaction, true);
          return transaction;
        },
      }),
    ];
  },
});
