import type { MessageKey } from '@nibleaf/i18n';
import type { Editor } from '@tiptap/core';
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
  if (editor.isActive('taskList')) return null;
  if (editor.isActive('orderedList')) return 'orderedList';
  if (editor.isActive('bulletList')) return 'bulletList';
  if (editor.isActive('heading', { level: 2 })) return 'heading2';
  if (editor.isActive('heading', { level: 3 })) return 'heading3';
  if (editor.isActive('heading')) return null;
  if (editor.isActive('blockquote')) return 'blockquote';
  if (editor.isActive('paragraph')) return 'paragraph';
  return null;
}

/**
 * Turns the selected blocks into `kind` with the editor's own commands, as one
 * undo step. Lists and quotes are unwrapped first, so a list item becomes a
 * heading rather than a heading stuck inside a list. Other containers (callouts,
 * table cells, components) are left in place. Focus and the selection stay in
 * the document.
 */
export function turnInto(editor: Editor, kind: TurnIntoKind): boolean {
  const chain = editor.chain().focus();
  const unwrapLists = () => {
    if (editor.isActive('bulletList')) chain.toggleBulletList();
    else if (editor.isActive('orderedList')) chain.toggleOrderedList();
    else if (editor.isActive('taskList')) chain.toggleTaskList();
  };
  const unwrapQuote = () => {
    if (editor.isActive('blockquote')) chain.unsetBlockquote();
  };
  switch (kind) {
    case 'paragraph':
      unwrapLists();
      unwrapQuote();
      chain.setParagraph();
      break;
    case 'heading2':
    case 'heading3':
      unwrapLists();
      unwrapQuote();
      chain.setHeading({ level: kind === 'heading2' ? 2 : 3 });
      break;
    case 'bulletList':
    case 'orderedList': {
      const isBullet = kind === 'bulletList';
      if (editor.isActive(isBullet ? 'bulletList' : 'orderedList')) return chain.run();
      // The other list type switches in place; anything else becomes list text.
      if (!editor.isActive(isBullet ? 'orderedList' : 'bulletList')) {
        unwrapLists();
        unwrapQuote();
        chain.setParagraph();
      }
      if (isBullet) chain.toggleBulletList();
      else chain.toggleOrderedList();
      break;
    }
    case 'blockquote': {
      const quoted = editor.isActive('blockquote');
      const listed = editor.isActive('bulletList') || editor.isActive('orderedList') || editor.isActive('taskList');
      if (quoted && !listed) return chain.run();
      // A list inside a quote becomes quoted text; it is never quoted twice.
      unwrapLists();
      chain.setParagraph();
      if (!quoted) chain.setBlockquote();
      break;
    }
    default:
      return false;
  }
  return chain.run();
}
