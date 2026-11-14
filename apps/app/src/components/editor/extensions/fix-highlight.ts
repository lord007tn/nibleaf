import { Extension } from '@tiptap/core';
import { type EditorState, Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { FixMatch } from '../publish-fix';

/** The places a publish check's Fix found, and which one the writer is on. */
interface FixHighlightState {
  matches: FixMatch[];
  current: number;
  decorations: DecorationSet;
}

const fixHighlightKey = new PluginKey<FixHighlightState>('publishFixHighlight');
const EMPTY: FixHighlightState = { matches: [], current: -1, decorations: DecorationSet.empty };

const decorate = (state: Pick<EditorState, 'doc'>, matches: FixMatch[], current: number): DecorationSet =>
  DecorationSet.create(
    state.doc,
    matches.map((match, index) => {
      const attrs = { class: index === current ? 'pl-fix-match pl-fix-current' : 'pl-fix-match', 'data-fix-match': String(index + 1) };
      return match.node ? Decoration.node(match.from, match.to, attrs) : Decoration.inline(match.from, match.to, attrs);
    }),
  );

/**
 * Marks the places a publish check's Fix landed on (P1-ED-002): every match
 * outlined, the current one drawn stronger (it flashes once, unless the writer
 * asked for less motion; tiptap.css). Decorations only: the document, its
 * Markdown and its undo history never change, so arriving is not an edit and
 * saves nothing. The marks follow the writer's edits and go when the bar closes.
 */
export const FixHighlight = Extension.create({
  name: 'publishFixHighlight',
  addProseMirrorPlugins() {
    return [
      new Plugin<FixHighlightState>({
        key: fixHighlightKey,
        state: {
          init: () => EMPTY,
          apply: (tr, previous, _old, next) => {
            const meta = tr.getMeta(fixHighlightKey) as { matches: FixMatch[]; current: number } | undefined;
            if (meta) return meta.matches.length ? { ...meta, decorations: decorate(next, meta.matches, meta.current) } : EMPTY;
            if (!tr.docChanged || previous.matches.length === 0) return previous;
            return { ...previous, decorations: previous.decorations.map(tr.mapping, tr.doc) };
          },
        },
        props: {
          decorations: (state) => fixHighlightKey.getState(state)?.decorations ?? null,
        },
      }),
    ];
  },
});

/** Mark `matches` on `tr`, with `current` the one the writer is on; an empty list clears the marks. */
export const setFixHighlight = (tr: Transaction, matches: FixMatch[], current: number): Transaction =>
  tr.setMeta(fixHighlightKey, { matches, current }).setMeta('addToHistory', false);
