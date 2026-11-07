import { mergeAttributes, Node } from '@tiptap/core';
import { type EditorState, Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { liftTarget } from '@tiptap/pm/transform';
import type { MarkdownNodeSpec } from 'tiptap-markdown';
import { preservedClosingTag, sourceMetadataAttributes, writeBlockTag } from './mdx-roundtrip';

/** Callout variants → emoji + the GitHub admonition keyword used for markdown round-trip. */
const CALLOUT_VARIANTS = {
  note: { icon: '💡', keyword: 'NOTE', label: 'Note' },
  tip: { icon: '💡', keyword: 'TIP', label: 'Tip' },
  check: { icon: '✅', keyword: 'CHECK', label: 'Check' },
  warning: { icon: '⚠️', keyword: 'WARNING', label: 'Warning' },
  danger: { icon: '🚫', keyword: 'CAUTION', label: 'Caution' },
  info: { icon: 'ℹ️', keyword: 'IMPORTANT', label: 'Info' },
} as const;

type CalloutVariant = keyof typeof CALLOUT_VARIANTS;

/** Keep authored titles and other attributes when changing an imported callout. */
export function calloutVariantAttributes(attributes: Record<string, unknown>, variant: CalloutVariant) {
  const tag = variant[0]?.toUpperCase() + variant.slice(1);
  let sourceOpen = String(attributes.sourceOpen ?? '');
  let sourceClose = String(attributes.sourceClose ?? '');
  if (/^\s*<Callout\b/.test(sourceOpen)) {
    const typeAttribute = /\btype\s*=\s*(?:"[^"]*"|'[^']*'|\{[^}]*\})/;
    sourceOpen = typeAttribute.test(sourceOpen)
      ? sourceOpen.replace(typeAttribute, `type="${variant}"`)
      : sourceOpen.replace('<Callout', `<Callout type="${variant}"`);
  } else {
    sourceOpen = sourceOpen.replace(/^(\s*<)(Note|Tip|Info|Check|Warning|Danger)\b/, `$1${tag}`);
    sourceClose = sourceClose.replace(/^(\s*<\/)(Note|Tip|Info|Check|Warning|Danger)\b/, `$1${tag}`);
  }
  return { variant, sourceOpen, sourceClose };
}

const KEYWORD_TO_VARIANT: Record<string, CalloutVariant> = Object.fromEntries(
  Object.entries(CALLOUT_VARIANTS).map(([variant, def]) => [def.keyword, variant as CalloutVariant]),
);

/** Resolve one of Nibleaf's canonical callout types/tag names to a variant. */
const normalizeVariant = (raw?: string | null): CalloutVariant => {
  const t = (raw ?? 'note').toLowerCase();
  if (t in CALLOUT_VARIANTS) {
    return t as CalloutVariant;
  }
  return 'note';
};

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      /** Wrap the selection (or insert) a callout block. */
      setCallout: (attributes?: { variant?: CalloutVariant }) => ReturnType;
      toggleCallout: (attributes?: { variant?: CalloutVariant }) => ReturnType;
      /** Remove the callout around the caret, keeping ALL of its content. */
      unsetCallout: () => ReturnType;
    };
  }
}

/** Depth of the innermost callout around the selection start, or 0. */
const calloutDepth = (state: EditorState): number => {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name === 'callout') return depth;
  }
  return 0;
};

/** Start position of the callout around the selection, or null outside one. */
const calloutStart = (state: EditorState): number | null => {
  const depth = calloutDepth(state);
  return depth ? state.selection.$from.before(depth) : null;
};

/**
 * Unwrap the callout around the caret as a whole: every paragraph, list and
 * nested block inside it moves out together. (A plain `lift` only moves the
 * block holding the caret, which splits a three-paragraph callout in two.)
 */
const unwrapCallout = (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
  const depth = calloutDepth(state);
  if (!depth) return false;
  const { $from } = state.selection;
  const callout = $from.node(depth);
  const start = $from.before(depth);
  const $contentStart = state.doc.resolve(start + 1);
  const $contentEnd = state.doc.resolve(start + callout.nodeSize - 1);
  const range = $contentStart.blockRange($contentEnd, (node) => node === callout);
  const target = range ? liftTarget(range) : null;
  if (!range || target === null || target === undefined) return false;
  dispatch?.(state.tr.lift(range, target).scrollIntoView());
  return true;
};

/** Hides the callout's type menu once the writer types in the callout, so it
 *  never sits over the lines being written (on phones especially). It returns
 *  when the caret moves into a callout again, or on a click inside one. */
const calloutMenuKey = new PluginKey<{ hidden: boolean }>('calloutMenu');
/** Transactions carrying this meta (e.g. a type change from the menu) keep the menu open. */
export const keepCalloutMenu = (tr: Transaction) => tr.setMeta(calloutMenuKey, { hidden: false });
export const isCalloutMenuHidden = (state: EditorState): boolean => calloutMenuKey.getState(state)?.hidden ?? false;

const calloutMenuPlugin = () =>
  new Plugin<{ hidden: boolean }>({
    key: calloutMenuKey,
    state: {
      init: () => ({ hidden: false }),
      apply(tr, value, oldState, newState) {
        const meta = tr.getMeta(calloutMenuKey) as { hidden: boolean } | undefined;
        if (meta) return meta;
        // Loading a page body (seeding, no update event) is not the writer typing.
        if (tr.getMeta('preventUpdate')) return { hidden: false };
        if (calloutStart(newState) !== calloutStart(oldState)) return { hidden: false };
        if (tr.docChanged && calloutStart(newState) !== null) return { hidden: true };
        return value;
      },
    },
    props: {
      handleClick(view) {
        if (calloutStart(view.state) !== null && isCalloutMenuHidden(view.state)) {
          view.dispatch(view.state.tr.setMeta(calloutMenuKey, { hidden: false }));
        }
        return false;
      },
    },
  });

/**
 * A colored callout/admonition block. Holds block content (usually a paragraph).
 *
 * Markdown round-trip: serialized as a GitHub-style blockquote admonition —
 * `> [!NOTE]\n> body` — which degrades to a plain blockquote anywhere that does
 * not understand the `[!NOTE]` marker, so nothing downstream breaks.
 */
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      ...sourceMetadataAttributes(),
      variant: {
        default: 'note' as CalloutVariant,
        // Derive the variant from data-variant, or from a Mintlify-style tag
        // (<Note>/<Tip>/…) name, or from <Callout type="…">.
        parseHTML: (element) => {
          const explicit = element.getAttribute('data-variant');
          if (explicit) {
            return normalizeVariant(explicit);
          }
          const tag = element.tagName.toLowerCase();
          return tag === 'callout' ? normalizeVariant(element.getAttribute('type')) : normalizeVariant(tag);
        },
        renderHTML: (attributes) => ({ 'data-variant': attributes.variant }),
      },
    };
  },

  // Parse our own div, the generic <Callout type="…">, and each Mintlify-style
  // callout tag (<Note>/<Tip>/<Info>/<Check>/<Warning>/<Danger>) so MDX-tag
  // callouts round-trip into editor blocks instead of being dropped on save.
  parseHTML() {
    return [{ tag: 'div[data-callout]' }, { tag: 'callout' }, ...Object.keys(CALLOUT_VARIANTS).map((variant) => ({ tag: variant }))];
  },

  renderHTML({ HTMLAttributes }) {
    const variant = (HTMLAttributes['data-variant'] as CalloutVariant) ?? 'note';
    const def = CALLOUT_VARIANTS[variant] ?? CALLOUT_VARIANTS.note;
    return [
      'div',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { 'data-callout': '', class: 'pl-callout' }),
      ['span', { class: 'pl-callout-icon', contenteditable: 'false' }, def.icon],
      ['div', { class: 'pl-callout-body' }, 0],
    ];
  },

  addCommands() {
    return {
      setCallout:
        (attributes) =>
        ({ commands }) =>
          commands.wrapIn(this.name, attributes),
      toggleCallout:
        (attributes) =>
        ({ commands }) =>
          commands.toggleWrap(this.name, attributes),
      unsetCallout:
        () =>
        ({ state, dispatch }) =>
          unwrapCallout(state, dispatch),
    };
  },

  addProseMirrorPlugins() {
    return [calloutMenuPlugin()];
  },

  addKeyboardShortcuts() {
    const unwrap = (key: 'Enter' | 'Backspace') => {
      const { selection } = this.editor.state;
      if (!selection.empty || !this.editor.isActive(this.name)) return false;
      const { $from } = selection;
      let depth = $from.depth;
      while (depth > 0 && $from.node(depth).type.name !== this.name) depth--;
      if (!depth) return false;
      if (key === 'Enter' && $from.parent.content.size === 0 && $from.index(depth) === $from.node(depth).childCount - 1)
        return this.editor.commands.lift(this.name);
      if (key === 'Backspace' && $from.parentOffset === 0 && $from.index(depth) === 0) return this.editor.commands.lift(this.name);
      return false;
    };
    return { Enter: () => unwrap('Enter'), Backspace: () => unwrap('Backspace') };
  },

  /**
   * tiptap-markdown integration. `serialize` emits a GitHub admonition blockquote;
   * `parse.setup` teaches markdown-it to recognise the `[!NOTE]` marker at the top
   * of a blockquote and rewrite it into our `data-callout` div before tiptap parses
   * the HTML.
   */
  addStorage() {
    return {
      markdown: {
        serialize(state, node) {
          const sourceOpen = String(node.attrs.sourceOpen ?? '');
          if (sourceOpen) {
            writeBlockTag(state, node, sourceOpen);
            state.renderContent(node);
            writeBlockTag(state, node, preservedClosingTag(node, 'Callout'));
            return;
          }
          const variant = (node.attrs.variant as CalloutVariant) ?? 'note';
          const def = CALLOUT_VARIANTS[variant] ?? CALLOUT_VARIANTS.note;
          state.write(`> [!${def.keyword}]\n`);
          state.wrapBlock('> ', null, node, () => state.renderContent(node));
        },
        parse: {
          updateDOM(element: HTMLElement) {
            // Rewrite `<blockquote><p>[!NOTE] ...</p>…</blockquote>` into a callout div.
            for (const quote of Array.from(element.querySelectorAll('blockquote'))) {
              const firstParagraph = quote.querySelector('p');
              const text = firstParagraph?.textContent ?? '';
              const match = text.match(/^\s*\[!(\w+)\]\s*/);
              if (!match) {
                continue;
              }
              const keyword = (match[1] ?? '').toUpperCase();
              const variant = KEYWORD_TO_VARIANT[keyword];
              if (!variant) {
                continue;
              }
              // Strip the `[!NOTE]` marker from the leading paragraph's first text,
              // keeping the rest of the paragraph as it is: setting its text
              // would flatten bold, links and code that follow the marker.
              if (firstParagraph) {
                const walker = element.ownerDocument.createTreeWalker(firstParagraph, 4 /* NodeFilter.SHOW_TEXT */);
                const firstText = walker.nextNode() as Text | null;
                if (firstText) firstText.data = firstText.data.replace(/^\s*\[!\w+\]\s*\n?/, '');
                // A line break right after the marker would otherwise open the callout.
                const lead = firstParagraph.firstChild;
                if (lead?.nodeType === 1 && (lead as Element).tagName === 'BR') lead.remove();
                else if (lead?.nodeType === 3 && !lead.textContent && lead.nextSibling?.nodeName === 'BR') lead.nextSibling.remove();
                if (firstText && !firstText.data.trim() && firstText.parentNode === firstParagraph) firstText.remove();
                if (!firstParagraph.textContent?.trim() && !firstParagraph.querySelector('img, code, a')) {
                  firstParagraph.remove();
                } else if (!firstParagraph.textContent?.trim() && [...firstParagraph.childNodes].every((child) => child.nodeName === 'IMG')) {
                  // A paragraph left holding only an image would save as an extra empty line.
                  firstParagraph.replaceWith(...firstParagraph.childNodes);
                }
              }
              const div = element.ownerDocument.createElement('div');
              div.setAttribute('data-callout', '');
              div.setAttribute('data-variant', variant);
              while (quote.firstChild) {
                div.appendChild(quote.firstChild);
              }
              quote.replaceWith(div);
            }
          },
        },
      } satisfies MarkdownNodeSpec,
    };
  },
});
