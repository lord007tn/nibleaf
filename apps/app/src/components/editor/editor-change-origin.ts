import type { Transaction } from '@tiptap/pm/state';

/*
 * Which document changes are the writer's, and so may change the draft and save
 * the page (P1-ED-001).
 *
 * Opening a page used to save it. StarterKit's trailing-node plugin adds an empty
 * paragraph after a page that ends with a block (an `<AccordionGroup>`, a
 * `<CardGroup>`, a code block, an image), as an appended transaction to whatever
 * transaction comes next. The first one after load was the editor's own empty
 * redraw of the comment highlights, dispatched before the page was even seeded.
 * TipTap reported that as an update, the editor emitted its serialization of the
 * page, which differs from the stored Markdown wherever the serializer writes
 * something differently (every hard-wrapped paragraph joined onto one line), and
 * autosave sent the whole page.
 *
 * Two rules here, so that no fix-up made by the editor or a plugin can do it again:
 * - only a transaction that itself changes the document is an edit. Typing,
 *   paste, drop, commands, a node view's own input and undo/redo all are. A
 *   plugin's change appended to a transaction that changed nothing (a selection,
 *   a redraw, a focus) is the editor tidying up, never the writer;
 * - an edit that brings the document back to what was loaded hands back the
 *   loaded Markdown itself, not the serializer's version of it, so the draft is
 *   clean again instead of differing from the stored copy only in form.
 */

/** Mark the editor's own transactions that only redraw decorations: no history
 *  entry, no update, and no trailing paragraph added on their account. */
export function redrawTransaction(transaction: Transaction): Transaction {
  return transaction.setMeta('addToHistory', false).setMeta('preventUpdate', true).setMeta('skipTrailingNode', true);
}

/** True when `transaction` is a change to the document the writer made (see above). */
export const isUserDocChange = (transaction: Transaction): boolean => transaction.docChanged;

/** The Markdown a page was loaded from, and the editor's serialization of it. */
export interface LoadedMarkdown {
  source: string;
  serialized: string;
}

/**
 * The Markdown to emit for the document's current serialization (see above). The
 * serializer never ends a page with a newline; a page loaded with one keeps it,
 * so an edit doesn't also change the page's last line.
 */
export function markdownToEmit(loaded: LoadedMarkdown | null, serialized: string): string {
  if (!loaded) return serialized;
  if (serialized === loaded.serialized) return loaded.source;
  return loaded.source.endsWith('\n') && serialized !== '' && !serialized.endsWith('\n') ? `${serialized}\n` : serialized;
}
