import type { Editor, TiptapEditorHTMLElement } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { NodeSelection, type Selection, TextSelection, type Transaction } from '@tiptap/pm/state';
import { clearUndoHistory } from './editor-history';
import { markSectionTarget } from './extensions/section-target';

/*
 * Sections of the page in the editor, named as the reader names them. A link
 * to `page#section` lands, on the published site, on the element whose DOM id
 * is `section`. Those ids come from the reader's own heading pass over the
 * page's Markdown (`@nibleaf/shared/reader-headings`, which the search index
 * records too, #534): explicit ids, math, inline HTML, headings inside
 * components and the duplicate suffixes are all the reader's. The editor never
 * computes an id itself. It runs that pass and maps each reader heading, in
 * document order, onto the block the editor shows it in.
 */

type ReaderHeadings = typeof import('@nibleaf/shared/reader-headings');
let readerHeadings: Promise<ReaderHeadings> | undefined;
/** The reader's heading pass (its Markdown, HTML and KaTeX stack), loaded the first time a section is looked for. */
const loadReaderHeadings = () => {
  readerHeadings ??= import('@nibleaf/shared/reader-headings');
  return readerHeadings;
};

/** A section anchor as the browser looks it up: without the `#`, percent-decoded. */
export const sectionFragment = (fragment: string): string => {
  const raw = fragment.startsWith('#') ? fragment.slice(1) : fragment;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
};

/** Whether the writer asked for less motion: then a jump is instant. */
export const prefersReducedMotion = (): boolean => {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  } catch {
    return false;
  }
};

/** The Markdown each editor was seeded with, and the document that produced. */
const seeded = new WeakMap<Editor, { markdown: string; doc: ProseMirrorNode }>();
/** Editors being seeded right now: their transactions are not the writer's. */
const seeding = new WeakSet<Editor>();

/**
 * Seed `editor` with its page's Markdown (`seed` replaces the document), and
 * remember that Markdown: it is what the reader renders, so the section
 * anchors come from it. Seeding also moves the caret, so a section is looked
 * for only once it has run. A seed leaves no undo history (#630): undo never
 * goes back past the content the page was last loaded with.
 */
export function seedPageContent(editor: Editor, markdown: string, seed: () => void): void {
  seeding.add(editor);
  try {
    seed();
    clearUndoHistory(editor);
  } finally {
    seeding.delete(editor);
  }
  seeded.set(editor, { markdown, doc: editor.state.doc });
}

/** The page's rich text editor inside `container`, once it holds the page's content. */
export const editorIn = (container: HTMLElement | null): Editor | null => {
  const editor = container?.querySelector<TiptapEditorHTMLElement>('.ProseMirror')?.editor;
  return editor && !editor.isDestroyed && seeded.has(editor) ? editor : null;
};

/** A reader anchor and where the editor shows it: on a heading, or on the block that holds it (a component the editor keeps whole). */
export interface SectionAnchor {
  id: string;
  position: number;
  heading: boolean;
}

interface MarkdownStorage {
  getMarkdown: () => string;
  serializer: { serialize: (doc: ProseMirrorNode) => string };
}

/** A block whose Markdown may hold a heading the reader renders: an ATX or setext line, or an HTML heading. */
const MAY_HOLD_HEADING = /^ {0,3}#{1,6}(?:[ \t]|$)|^ {0,3}(?:=+|-+)[ \t]*$|<h[1-6][\s>/]/im;

/**
 * Pair reader headings with the editor's, in order, scoring the best overall
 * pairing: the same level and text is a pair, and so (weaker) is the same level
 * with one text starting the other (the editor shows some headings in part: an
 * image in a heading becomes its own block). Then, between two pairs, a lone
 * reader heading and a lone editor heading of the same level pair up (math the
 * reader typesets). Anything else stays unpaired, so it never shifts the pairs
 * after it.
 */
function pairInOrder(reader: readonly { depth: number; key: string }[], editor: readonly { depth: number; key: string }[]): [number, number][] {
  const score = (i: number, j: number) => {
    const a = reader[i];
    const b = editor[j];
    if (!(a && b) || a.depth !== b.depth) return 0;
    if (a.key === b.key) return 2;
    return a.key && b.key && (a.key.startsWith(b.key) || b.key.startsWith(a.key)) ? 1 : 0;
  };
  const width = editor.length + 1;
  // The best total score pairing reader[i..] with editor[j..].
  const best = new Uint32Array((reader.length + 1) * width);
  const at = (i: number, j: number) => best[i * width + j] ?? 0;
  for (let i = reader.length - 1; i >= 0; i -= 1)
    for (let j = editor.length - 1; j >= 0; j -= 1) {
      const paired = score(i, j);
      best[i * width + j] = Math.max(at(i + 1, j), at(i, j + 1), paired ? paired + at(i + 1, j + 1) : 0);
    }
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < reader.length && j < editor.length) {
    const paired = score(i, j);
    if (paired && at(i, j) === paired + at(i + 1, j + 1)) pairs.push([i++, j++]);
    else if (at(i + 1, j) >= at(i, j + 1)) i += 1;
    else j += 1;
  }
  const lone: [number, number][] = [];
  let lastReader = -1;
  let lastEditor = -1;
  for (const [ri, ei] of [...pairs, [reader.length, editor.length] as [number, number]]) {
    if (ri - lastReader === 2 && ei - lastEditor === 2 && reader[ri - 1]?.depth === editor[ei - 1]?.depth) lone.push([ri - 1, ei - 1]);
    lastReader = ri;
    lastEditor = ei;
  }
  return [...pairs, ...lone].sort((a, b) => a[0] - b[0]);
}

/**
 * The page's section anchors as the reader gives them, each placed on the
 * editor block that shows it. The Markdown is the page's own while the
 * document is as seeded, and the editor's once the writer has changed it (what
 * the page will be saved as).
 */
export async function editorSectionAnchors(editor: Editor): Promise<SectionAnchor[]> {
  const reader = await loadReaderHeadings();
  const storage = (editor.storage as unknown as { markdown?: MarkdownStorage }).markdown;
  if (editor.isDestroyed || !storage) return [];
  const { doc, schema } = editor.state;
  const page = seeded.get(editor);
  const published = reader.readerHeadings(page && page.doc === doc ? page.markdown : storage.getMarkdown());
  const serialize = (node: ProseMirrorNode) => storage.serializer.serialize(schema.topNodeType.create(null, node));
  const shown: { depth: number; key: string; position: number; heading: boolean }[] = [];
  doc.forEach((block, offset) => {
    const headings: { node: ProseMirrorNode; position: number }[] = [];
    if (block.type.name === 'heading') headings.push({ node: block, position: offset });
    else
      block.descendants((node, position) => {
        if (node.type.name !== 'heading') return true;
        headings.push({ node, position: offset + 1 + position });
        return false;
      });
    for (const { node, position } of headings) {
      // The heading's text as the reader renders it (inline code, math, entities).
      const text = reader.readerHeadings(serialize(node))[0]?.text ?? node.textContent;
      shown.push({ depth: Number(node.attrs.level), key: reader.readerHeadingKey(text), position, heading: true });
    }
    if (headings.length > 0) return;
    // A block the editor shows whole (an unsupported component, raw HTML): the reader's headings in it land on it.
    const markdown = serialize(block);
    if (!MAY_HOLD_HEADING.test(markdown)) return;
    for (const heading of reader.readerHeadings(markdown))
      shown.push({ depth: heading.depth, key: reader.readerHeadingKey(heading.text), position: offset, heading: false });
  });
  const keyed = published.map((heading) => ({ depth: heading.depth, key: reader.readerHeadingKey(heading.text) }));
  return pairInOrder(keyed, shown).flatMap(([ri, ei]) => {
    const id = published[ri]?.id;
    const place = shown[ei];
    return id && place ? [{ id, position: place.position, heading: place.heading }] : [];
  });
}

/** Scroll `anchor` to the top and put focus there: the caret at the heading's start (or on the block), or, read-only, focus on it. */
function land(editor: Editor, anchor: SectionAnchor, smooth: boolean): void {
  const { view } = editor;
  const element = view.nodeDOM(anchor.position);
  if (!(element instanceof HTMLElement)) return;
  element.scrollIntoView?.({ block: 'start', inline: 'nearest', behavior: smooth ? 'smooth' : 'auto' });
  if (!editor.isEditable) {
    markSectionTarget(view, anchor.position)?.focus({ preventScroll: true });
    return;
  }
  const { doc } = view.state;
  const block = doc.nodeAt(anchor.position);
  let selection: Selection;
  if (anchor.heading) selection = TextSelection.create(doc, anchor.position + 1);
  else if (block && NodeSelection.isSelectable(block)) selection = NodeSelection.create(doc, anchor.position);
  else selection = TextSelection.near(doc.resolve(anchor.position));
  view.dispatch(view.state.tr.setSelection(selection).setMeta('addToHistory', false));
  // Focus now, not on a later frame: nothing the writer does next can be overridden.
  view.focus();
}

/** What the writer does that ends a pending landing, anywhere in the document. */
const WRITER_EVENTS = ['pointerdown', 'keydown', 'beforeinput', 'input'] as const;

/**
 * Land on `section` in the editor `find` returns, once it holds the page's
 * content: wait for that (at most `waitFrames` frames), then look the section
 * up once. No such section ends it, at the top.
 *
 * The writer always wins: a pointer press, a key, any input, or a selection
 * change the writer makes in the editor ends the landing before it moves
 * anything, and so does focus moving elsewhere (a title or a settings field).
 * Returns the function that ends it.
 */
export function landOnSection({
  find,
  section,
  smooth,
  waitFrames,
}: {
  find: () => Editor | null;
  section: string;
  smooth: boolean;
  waitFrames: number;
}): () => void {
  let done = false;
  let frame = 0;
  let frames = 0;
  let editor: Editor | null = null;
  const startedOn = document.activeElement;
  const onTransaction = ({ transaction }: { transaction: Transaction }) => {
    if (editor && !seeding.has(editor) && (transaction.selectionSet || transaction.docChanged)) end();
  };
  const end = () => {
    if (done) return;
    done = true;
    cancelAnimationFrame(frame);
    for (const type of WRITER_EVENTS) document.removeEventListener(type, end, true);
    editor?.off('transaction', onTransaction);
  };
  for (const type of WRITER_EVENTS) document.addEventListener(type, end, true);
  const focusMovedAway = () => {
    const active = document.activeElement;
    return Boolean(active && active !== startedOn && active !== document.body && !active.closest('.ProseMirror'));
  };
  const look = () => {
    if (done) return;
    if (focusMovedAway()) return end();
    const found = find();
    if (!found) {
      if (frames++ < waitFrames) frame = requestAnimationFrame(look);
      else end();
      return;
    }
    editor = found;
    found.on('transaction', onTransaction);
    void editorSectionAnchors(found).then(
      (anchors) => {
        if (done || found.isDestroyed || focusMovedAway()) return end();
        const anchor = anchors.find((candidate) => candidate.id === section);
        end();
        if (anchor) land(found, anchor, smooth);
      },
      () => end(),
    );
  };
  look();
  return end;
}
