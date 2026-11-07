import Image from '@tiptap/extension-image';
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state';
import { ReplaceAroundStep, ReplaceStep } from '@tiptap/pm/transform';
import type { MarkdownNodeSpec } from 'tiptap-markdown';

export const imagePromptKey = new PluginKey<number>('image-description-prompt');
const htmlAttribute = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
const dimension = (value: unknown, key: string): number | '100%' | null => {
  if (key === 'width' && value === '100%') return value;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
};

/** Block boundaries and dimensions must survive both Markdown and HTML image syntax. */
export const BlockImage = Image.extend({
  addNodeView() {
    return ({ node, getPos, editor }) => {
      let current = node;
      const dom = document.createElement('div');
      dom.className = 'editor-image';
      const image = document.createElement('img');
      image.draggable = true;
      dom.append(image);
      const sync = () => {
        for (const key of ['src', 'alt', 'title']) {
          if (key === 'alt' || current.attrs[key] != null) image.setAttribute(key, String(current.attrs[key] ?? ''));
          else image.removeAttribute(key);
        }
        dom.style.width = current.attrs.width === '100%' ? '100%' : current.attrs.width ? `${current.attrs.width}px` : 'fit-content';
        image.style.width = current.attrs.width ? '100%' : '';
      };
      sync();
      let cancelDrag: (() => void) | undefined;
      for (const side of ['left', 'right'] as const) {
        const handle = document.createElement('span');
        handle.className = `editor-image-handle editor-image-handle-${side}`;
        handle.setAttribute('aria-hidden', 'true');
        handle.onpointerdown = (event) => {
          if (!editor.isEditable) return;
          event.preventDefault();
          cancelDrag?.();
          const position = getPos();
          if (position === undefined) return;
          editor.commands.setNodeSelection(position);
          const initial = image.getBoundingClientRect().width;
          const start = event.clientX;
          let width = initial;
          const move = (next: PointerEvent) => {
            width = Math.max(
              80,
              Math.min(dom.parentElement?.clientWidth || 1600, Math.round(initial + (next.clientX - start) * (side === 'left' ? -1 : 1))),
            );
            dom.style.width = `${width}px`;
            image.style.width = '100%';
          };
          const finish = () => {
            cancelDrag?.();
            const pos = getPos();
            if (pos !== undefined && !editor.isDestroyed)
              editor.chain().setNodeSelection(pos).updateAttributes('image', { width, height: null }).run();
          };
          cancelDrag = () => {
            document.removeEventListener('pointermove', move);
            document.removeEventListener('pointerup', finish);
            document.removeEventListener('pointercancel', abort);
            cancelDrag = undefined;
          };
          const abort = () => {
            cancelDrag?.();
            sync();
          };
          document.addEventListener('pointermove', move);
          document.addEventListener('pointerup', finish);
          document.addEventListener('pointercancel', abort);
        };
        dom.append(handle);
      }
      return {
        dom,
        update(updated) {
          if (updated.type !== current.type) return false;
          current = updated;
          sync();
          return true;
        },
        selectNode() {
          dom.classList.add('ProseMirror-selectednode');
        },
        deselectNode() {
          dom.classList.remove('ProseMirror-selectednode');
        },
        stopEvent: (event) => event.target instanceof HTMLElement && event.target.classList.contains('editor-image-handle'),
        ignoreMutation: () => true,
        destroy() {
          cancelDrag?.();
        },
      };
    };
  },
  addAttributes() {
    return {
      ...this.parent?.(),
      ...Object.fromEntries(
        ['width', 'height'].map((key) => [
          key,
          {
            default: null,
            parseHTML: (element: HTMLElement) => dimension(element.getAttribute(key), key),
            renderHTML: (attributes: Record<string, unknown>) => (dimension(attributes[key], key) ? { [key]: dimension(attributes[key], key) } : {}),
          },
        ]),
      ),
    };
  },
  addStorage() {
    return {
      markdown: {
        serialize(state, node) {
          if (node.attrs.width || node.attrs.height) {
            const attributes = ['src', 'alt', 'title', 'width', 'height']
              .filter((key) => key === 'alt' || (node.attrs[key] !== null && node.attrs[key] !== undefined))
              .map((key) => `${key}="${htmlAttribute(node.attrs[key])}"`);
            state.write(`<img ${attributes.join(' ')} />`);
          } else {
            const src = String(node.attrs.src ?? '').replace(/[\\()]/g, '\\$&');
            const title = node.attrs.title ? ` "${String(node.attrs.title).replace(/[\\"]/g, '\\$&')}"` : '';
            state.write(`![${state.esc(String(node.attrs.alt ?? ''))}](${src}${title})`);
          }
          state.closeBlock(node);
        },
        parse: {},
      } satisfies MarkdownNodeSpec,
    };
  },
  addProseMirrorPlugins() {
    return [
      ...(this.parent?.() ?? []),
      new Plugin({
        key: imagePromptKey,
        state: { init: () => 0, apply: (tr, version) => (tr.getMeta(imagePromptKey) ? version + 1 : version) },
        appendTransaction(transactions, oldState, state) {
          if (!transactions.some((tr) => tr.docChanged) || transactions.some((tr) => tr.getMeta('preventUpdate') || tr.getMeta(imagePromptKey)))
            return null;
          // Ordinary typing must not scan a whole pasted article just to check for images.
          let hasImage = false;
          for (const transaction of transactions)
            for (const step of transaction.steps) {
              if (!(step instanceof ReplaceStep || step instanceof ReplaceAroundStep)) continue;
              step.slice.content.descendants((node) => {
                if (node.type.name === 'image') hasImage = true;
              });
            }
          if (!hasImage) return null;
          const previous = new Set<object>();
          oldState.doc.descendants((node) => {
            if (node.type.name === 'image') previous.add(node);
          });
          // Attribute edits replace a node too; only prompt when the number of images grows,
          // or the clipboard/drop explicitly replaces an existing image.
          let count = 0;
          let inserted: number | null = null;
          state.doc.descendants((node, pos) => {
            if (node.type.name !== 'image') return;
            count++;
            if (!previous.has(node)) inserted = pos;
          });
          const clipboard = transactions.some((tr) => ['paste', 'drop'].includes(tr.getMeta('uiEvent')));
          if (inserted === null || (count <= previous.size && !clipboard)) return null;
          return state.tr.setSelection(NodeSelection.create(state.doc, inserted)).setMeta(imagePromptKey, true);
        },
      }),
    ];
  },
});
