import { readerHeadingIdGenerator } from '@nibleaf/shared/reader-heading-ids';
import type { Editor, TiptapEditorHTMLElement } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { markSectionTarget } from './extensions/section-target';

/*
 * Sections of the page in the editor, named as the reader names them. A link
 * to `page#section` lands, on the published site, on the heading whose DOM id
 * is `section`; the reader gives headings their ids with
 * `@nibleaf/shared/reader-heading-ids`, which the search index records too
 * (#534). The editor names its headings with that same generator, over the
 * same headings in the same order, so a link lands on the same heading here.
 */

/** A section anchor as the browser looks it up: without the `#`, percent-decoded. */
export const sectionFragment = (fragment: string): string => {
  const raw = fragment.startsWith('#') ? fragment.slice(1) : fragment;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
};

/** The page's headings in document order, each with the id the reader gives it. */
export function editorHeadingAnchors(doc: ProseMirrorNode): { id: string; position: number }[] {
  const nextId = readerHeadingIdGenerator();
  const anchors: { id: string; position: number }[] = [];
  doc.descendants((node, position) => {
    if (node.type.name !== 'heading') return true;
    // The heading's text as the reader's DOM reads it: inline atoms (a line break, an image) add nothing.
    anchors.push({ id: nextId(node.textBetween(0, node.content.size, '', '')), position });
    return false;
  });
  return anchors;
}

/** Whether the writer asked for less motion: then a jump is instant. */
export const prefersReducedMotion = (): boolean => {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  } catch {
    return false;
  }
};

/** Editors holding their page's content (seeded from its Markdown). */
const loaded = new WeakSet<Editor>();

/** Record that `editor` now holds its page's content. Seeding replaces the document and
 *  moves the caret, so a section is looked for only after it. */
export const markPageContentLoaded = (editor: Editor): void => {
  loaded.add(editor);
};

/** The page's rich text editor inside `container`, once it holds the page's content. */
export const editorIn = (container: HTMLElement | null): Editor | null => {
  const element = container?.querySelector<TiptapEditorHTMLElement>('.ProseMirror');
  const editor = element?.editor;
  return editor && !editor.isDestroyed && loaded.has(editor) ? editor : null;
};

/**
 * Go to the heading `section` names: scroll it to the top of the view (smoothly
 * only when `smooth`), and put focus there, so a screen reader announces it.
 * While editing, the caret goes to the heading's start; a read-only page
 * focuses the heading itself. Returns false, and does nothing, when no heading
 * has that anchor.
 */
export function jumpToSection(editor: Editor, section: string, { smooth }: { smooth: boolean }): boolean {
  const target = section ? editorHeadingAnchors(editor.state.doc).find((heading) => heading.id === section) : undefined;
  const element = target ? editor.view.nodeDOM(target.position) : null;
  if (!(target && element instanceof HTMLElement)) return false;
  element.scrollIntoView?.({ block: 'start', inline: 'nearest', behavior: smooth ? 'smooth' : 'auto' });
  if (editor.isEditable) {
    editor.commands.focus(target.position + 1, { scrollIntoView: false });
  } else {
    markSectionTarget(editor.view, target.position)?.focus({ preventScroll: true });
  }
  return true;
}
