import type { MessageKey } from '@nibleaf/i18n';
import type { Editor } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import { liftListItem } from '@tiptap/pm/schema-list';
import { EditorState, type SelectionBookmark, TextSelection, type Transaction } from '@tiptap/pm/state';
import { liftTarget } from '@tiptap/pm/transform';
import { Heading2, Heading3, List, ListOrdered, Quote, Type } from 'lucide-react';
import type { ComponentType } from 'react';

/** The block types the selection menu's "Turn into" offers (audit AUTH-37). */
export type TurnIntoKind = 'paragraph' | 'heading2' | 'heading3' | 'bulletList' | 'orderedList' | 'blockquote';

export interface TurnIntoOption {
  kind: TurnIntoKind;
  /** Reuses the slash menu's names, so both menus speak the same words. */
  labelKey: MessageKey;
  icon: ComponentType<{ className?: string }>;
}

export const TURN_INTO_OPTIONS: TurnIntoOption[] = [
  { kind: 'paragraph', labelKey: 'editor.slash.text.title', icon: Type },
  { kind: 'heading2', labelKey: 'editor.slash.h2.title', icon: Heading2 },
  { kind: 'heading3', labelKey: 'editor.slash.h3.title', icon: Heading3 },
  { kind: 'bulletList', labelKey: 'editor.slash.bulletList.title', icon: List },
  { kind: 'orderedList', labelKey: 'editor.slash.numberedList.title', icon: ListOrdered },
  { kind: 'blockquote', labelKey: 'editor.slash.quote.title', icon: Quote },
];

/**
 * The selection's block type among the "Turn into" choices, innermost wrapper
 * first (a list inside a quote is a list). Null for types the menu doesn't
 * offer (Heading 1, to-do lists), so no choice shows as selected.
 */
export function currentTurnIntoKind(editor: Editor): TurnIntoKind | null {
  // The nearest list decides: a bulleted list nested in a numbered one is bulleted.
  const list = nearestListType(editor.state);
  if (list === 'orderedList' || list === 'bulletList') return list;
  if (list) return null;
  if (editor.isActive('heading', { level: 2 })) return 'heading2';
  if (editor.isActive('heading', { level: 3 })) return 'heading3';
  if (editor.isActive('heading')) return null;
  if (editor.isActive('blockquote')) return 'blockquote';
  if (editor.isActive('paragraph')) return 'paragraph';
  return null;
}

const LIST_ITEMS = new Set(['listItem', 'taskItem']);
const LISTS = new Set(['bulletList', 'orderedList', 'taskList']);

/**
 * The list type nearest to the selected textblocks: their shared innermost list,
 * 'mixed' when they are all in lists of different types, or null when any of
 * them is outside a list. Ancestor lists further out don't count.
 */
function nearestListType({ doc, selection }: Pick<EditorState, 'doc' | 'selection'>): string | null {
  let shared: string | null | undefined;
  doc.nodesBetween(selection.from, selection.to, (node, pos) => {
    if (!node.isTextblock) return true;
    const $pos = doc.resolve(pos + 1);
    let type: string | null = null;
    for (let depth = $pos.depth - 1; depth > 0 && !type; depth -= 1) {
      const name = $pos.node(depth).type.name;
      if (LISTS.has(name)) type = name;
    }
    if (type === null || shared === null) shared = null;
    else if (shared === undefined) shared = type;
    else if (shared !== type) shared = 'mixed';
    return false;
  });
  return shared ?? null;
}

/** Positions inside each textblock the selection touches, in document order. */
function selectedTextblocks(tr: Transaction): number[] {
  const { from, to } = tr.selection;
  const blocks: number[] = [];
  tr.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true;
    blocks.push(pos + 1);
    return false;
  });
  return blocks;
}

/** Whether any selected textblock sits directly in a list item. */
function selectionTouchesList(tr: Transaction): boolean {
  return selectedTextblocks(tr).some((pos) => {
    const $pos = tr.doc.resolve(pos);
    return $pos.depth > 1 && LIST_ITEMS.has($pos.node($pos.depth - 1).type.name);
  });
}

/**
 * Takes every selected textblock out of its lists (and, with `quotes`, out of
 * its quotes), one block at a time, so a selection that mixes a paragraph and a
 * list item converts both. A list item keeps its nested items: they stay a list
 * after the lifted text, as when the editor lifts a single item. Other
 * containers (callouts, table cells, components) are left in place.
 */
function liftBlocks(tr: Transaction, { quotes }: { quotes: boolean }) {
  const startStep = tr.steps.length;
  for (const original of selectedTextblocks(tr)) {
    // Each lift moves the text one level out; nested items need several.
    for (let level = 0; level < 32; level += 1) {
      const pos = tr.mapping.slice(startStep).map(original);
      const $pos = tr.doc.resolve(pos);
      if ($pos.depth < 2) break;
      const wrapper = $pos.node($pos.depth - 1);
      if (LIST_ITEMS.has(wrapper.type.name)) {
        const state = EditorState.create({ doc: tr.doc, selection: TextSelection.create(tr.doc, pos) });
        const lifted = liftListItem(wrapper.type)(state, (liftTr) => {
          for (const step of liftTr.steps) tr.step(step);
        });
        if (!lifted) break;
        continue;
      }
      if (quotes && wrapper.type.name === 'blockquote') {
        const range = $pos.blockRange();
        const target = range ? liftTarget(range) : null;
        if (!range || target === null) break;
        tr.lift(range, target);
        continue;
      }
      break;
    }
  }
}

/**
 * Turns the selected blocks into `kind` with the editor's own commands, as one
 * undo step of its own. Each selected block is taken out of lists and quotes
 * first, so a list item becomes a heading rather than a heading stuck inside a
 * list. Focus stays in the document and the selection covers the same text;
 * undo restores the selection exactly.
 */
export function turnInto(editor: Editor, kind: TurnIntoKind): boolean {
  let bookmark: SelectionBookmark | null = null;
  let firstStep = 0;
  // A conversion right after typing is still its own undo step, and undo puts
  // back the selection it was made from.
  const chain = editor
    .chain()
    .focus()
    .command(({ tr }) => {
      closeHistory(tr);
      bookmark = tr.selection.getBookmark();
      firstStep = tr.steps.length;
      return true;
    });
  const lift = (quotes: boolean) =>
    chain.command(({ tr }) => {
      liftBlocks(tr, { quotes });
      return true;
    });
  switch (kind) {
    case 'paragraph':
      lift(true).setParagraph();
      break;
    case 'heading2':
    case 'heading3':
      lift(true).setHeading({ level: kind === 'heading2' ? 2 : 3 });
      break;
    case 'bulletList':
    case 'orderedList': {
      const isBullet = kind === 'bulletList';
      // Only the nearest list counts, so a bulleted list nested in a numbered one
      // can still become numbered.
      const nearest = nearestListType(editor.state);
      if (nearest === kind) return editor.commands.focus();
      // A selection whose nearest list is the other type switches that list in
      // place, keeping its nesting; anything else becomes list text first.
      if (nearest !== (isBullet ? 'orderedList' : 'bulletList')) lift(true).setParagraph();
      if (isBullet) chain.toggleBulletList();
      else chain.toggleOrderedList();
      break;
    }
    case 'blockquote': {
      const quoted = editor.isActive('blockquote');
      if (quoted && !selectionTouchesList(editor.state.tr)) return editor.commands.focus();
      // A list inside a quote becomes quoted text; it is never quoted twice.
      lift(!quoted).setParagraph();
      if (!quoted) chain.setBlockquote();
      break;
    }
    default:
      return false;
  }
  return chain
    .command(({ tr }) => {
      const saved = bookmark as SelectionBookmark | null;
      if (saved) tr.setSelection(saved.map(tr.mapping.slice(firstStep)).resolve(tr.doc));
      return true;
    })
    .run();
}
