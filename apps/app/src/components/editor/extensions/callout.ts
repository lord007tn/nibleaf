import { mergeAttributes, Node } from '@tiptap/core';
import type { MarkdownNodeSpec } from 'tiptap-markdown';

/** Callout variants → emoji + the GitHub admonition keyword used for markdown round-trip. */
export const CALLOUT_VARIANTS = {
  note: { icon: '💡', keyword: 'NOTE', label: 'Note' },
  tip: { icon: '✅', keyword: 'TIP', label: 'Tip' },
  warning: { icon: '⚠️', keyword: 'WARNING', label: 'Warning' },
  danger: { icon: '🚫', keyword: 'CAUTION', label: 'Caution' },
  info: { icon: 'ℹ️', keyword: 'IMPORTANT', label: 'Info' },
} as const;

export type CalloutVariant = keyof typeof CALLOUT_VARIANTS;

const KEYWORD_TO_VARIANT: Record<string, CalloutVariant> = Object.fromEntries(
  Object.entries(CALLOUT_VARIANTS).map(([variant, def]) => [def.keyword, variant as CalloutVariant]),
);

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      /** Wrap the selection (or insert) a callout block. */
      setCallout: (attributes?: { variant?: CalloutVariant }) => ReturnType;
      toggleCallout: (attributes?: { variant?: CalloutVariant }) => ReturnType;
    };
  }
}

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
      variant: {
        default: 'note' as CalloutVariant,
        parseHTML: (element) => element.getAttribute('data-variant') ?? 'note',
        renderHTML: (attributes) => ({ 'data-variant': attributes.variant }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-callout]' }];
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
    };
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
              // Strip the `[!NOTE]` marker from the leading paragraph.
              if (firstParagraph) {
                firstParagraph.textContent = text.replace(/^\s*\[!\w+\]\s*\n?/, '');
                if (!firstParagraph.textContent.trim()) {
                  firstParagraph.remove();
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

export default Callout;
