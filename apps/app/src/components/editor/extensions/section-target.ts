import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';

const sectionTargetKey = new PluginKey<number | null>('sectionTarget');

/**
 * The heading a link to `page#section` landed on, made focusable. A read-only
 * page has no caret to put there, so focus goes to the heading itself (as the
 * reader's in-page links do): a screen reader announces it, and Tab continues
 * from it. The heading stays focusable until the next landing or until it is
 * edited away.
 */
export const SectionTarget = Extension.create({
  name: 'sectionTarget',
  addProseMirrorPlugins() {
    return [
      new Plugin<number | null>({
        key: sectionTargetKey,
        state: {
          init: () => null,
          apply: (tr, position) => {
            const next = tr.getMeta(sectionTargetKey) as number | null | undefined;
            if (next !== undefined) return next;
            if (position === null || !tr.docChanged) return position;
            const mapped = tr.mapping.mapResult(position);
            return mapped.deleted ? null : mapped.pos;
          },
        },
        props: {
          decorations: (state) => {
            const position = sectionTargetKey.getState(state);
            const node = position == null ? null : state.doc.nodeAt(position);
            if (position == null || !node) return null;
            return DecorationSet.create(state.doc, [Decoration.node(position, position + node.nodeSize, { tabindex: '-1' })]);
          },
        },
      }),
    ];
  },
});

/** Make the block at `position` the focusable landing heading, and return its element. */
export const markSectionTarget = (view: EditorView, position: number): HTMLElement | null => {
  view.dispatch(view.state.tr.setMeta(sectionTargetKey, position));
  const element = view.nodeDOM(position);
  return element instanceof HTMLElement ? element : null;
};
