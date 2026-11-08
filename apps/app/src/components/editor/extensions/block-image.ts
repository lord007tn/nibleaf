import { translateFn } from '@nibleaf/i18n';
import Image from '@tiptap/extension-image';
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state';
import { ReplaceAroundStep, ReplaceStep } from '@tiptap/pm/transform';
import type { MarkdownNodeSpec } from 'tiptap-markdown';
import { allowedURL, escapeImageAttribute, IMAGE_UPLOAD_PLACEHOLDER_PREFIX, imageClasses, imageDimension, isLegacyImageSource } from './html-safety';
import { imageAttributeNames, safeImageTag, setupImageSource, snapshotImageSource, sourceImageAttribute } from './image-source';
import { canEditImages, editorImageUploader, uploadEditorImage } from './image-upload';
import { sourceMetadataAttributes } from './mdx-roundtrip';
import { fileFromPastedImage } from './pasted-image';

export const imagePromptKey = new PluginKey<number>('image-description-prompt');
let legacyNoticeIds = 0;

/** Block boundaries and dimensions must survive both Markdown and HTML image syntax. */
export const BlockImage = Image.extend({
  parseHTML() {
    return [{ tag: 'img[src]', getAttrs: (element) => (allowedURL(element.getAttribute('src') ?? '', ['http', 'https']) ? null : false) }];
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      let current = node;
      const dom = document.createElement('div');
      dom.className = 'editor-image';
      const image = document.createElement('img');
      image.draggable = true;
      dom.append(image);
      const version = document.createElement('span');
      version.className = 'text-xs text-muted-foreground';
      dom.append(version);
      const describe = document.createElement('button');
      describe.type = 'button';
      describe.className = 'min-h-11 px-2 text-sm focus-visible:outline-2';
      describe.textContent = translateFn('editor.image.describe');
      describe.onclick = () => {
        const pos = getPos();
        if (pos === undefined || !canEditImages(editor)) return;
        const tr = editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, descriptionPending: false });
        editor.view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, pos)).setMeta(imagePromptKey, { focus: true }));
      };
      dom.append(describe);
      const hint = document.createElement('span');
      hint.className = 'image-description-hint block text-xs text-muted-foreground';
      dom.append(hint);
      // An inline (base64) image is kept in the source but the published site drops it.
      // Say so, and offer to move it to an uploaded file in one step.
      const legacy = current.type.name === 'legacyImage';
      let legacyUploading = false;
      const legacyRow = document.createElement('span');
      legacyRow.className = 'editor-image-legacy flex flex-wrap items-center gap-2';
      const notice = document.createElement('span');
      notice.id = `editor-image-legacy-${++legacyNoticeIds}`;
      notice.className = 'inline-flex items-center rounded-md border border-warning/30 bg-warning/10 px-2 py-0.5 text-xs text-warning';
      notice.textContent = translateFn('editor.image.legacyNotShown');
      const uploadLegacy = document.createElement('button');
      uploadLegacy.type = 'button';
      uploadLegacy.className = 'min-h-11 px-2 text-sm focus-visible:outline-2';
      uploadLegacy.textContent = translateFn('editor.image.legacyUpload');
      uploadLegacy.setAttribute('aria-describedby', notice.id);
      uploadLegacy.onclick = () => {
        const pos = getPos();
        const upload = editorImageUploader(editor);
        if (pos === undefined || !upload || legacyUploading || !canEditImages(editor)) return;
        const source = String(current.attrs.src ?? '');
        const file = fileFromPastedImage(source);
        if (!file) return;
        legacyUploading = true;
        sync();
        void uploadEditorImage(editor, file, upload, pos, {}, source).finally(() => {
          legacyUploading = false;
          sync();
        });
      };
      legacyRow.append(notice, uploadLegacy);
      if (legacy) dom.append(legacyRow);
      const sync = () => {
        for (const key of ['src', 'alt', 'title']) {
          if (key === 'alt' || current.attrs[key] != null) image.setAttribute(key, String(current.attrs[key] ?? ''));
          else image.removeAttribute(key);
        }
        dom.style.width =
          typeof current.attrs.width === 'string' && current.attrs.width.endsWith('%')
            ? current.attrs.width
            : current.attrs.width
              ? `${current.attrs.width}px`
              : 'fit-content';
        image.style.width = current.attrs.width ? '100%' : '';
        const classes = `${current.attrs.class ?? ''} ${current.attrs.className ?? ''}`.split(/\s+/);
        // Show both variants deliberately so writers can select and describe either.
        version.textContent = classes.includes('dark:hidden')
          ? translateFn('editor.image.lightVersion')
          : classes.includes('dark:block') || classes.includes('dark:inline') || classes.includes('dark:inline-block')
            ? translateFn('editor.image.darkVersion')
            : '';
        describe.hidden = current.type.name !== 'image' || (!!current.attrs.alt && !current.attrs.descriptionPending) || !canEditImages(editor);
        hint.textContent = current.attrs.descriptionPending ? translateFn('editor.image.descriptionHint') : '';
        hint.hidden = !current.attrs.descriptionPending || !canEditImages(editor);
        uploadLegacy.hidden = !legacy || legacyUploading || !canEditImages(editor) || !editorImageUploader(editor);
      };
      sync();
      let cancelDrag: (() => void) | undefined;
      for (const side of ['left', 'right'] as const) {
        if (current.type.name !== 'image') continue;
        const handle = document.createElement('span');
        handle.className = `editor-image-handle editor-image-handle-${side}`;
        handle.setAttribute('aria-hidden', 'true');
        handle.onpointerdown = (event) => {
          if (!canEditImages(editor)) return;
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
              Math.min(4000, dom.parentElement?.clientWidth || 1600, Math.round(initial + (next.clientX - start) * (side === 'left' ? -1 : 1))),
            );
            dom.style.width = `${width}px`;
            image.style.width = '100%';
          };
          const finish = () => {
            cancelDrag?.();
            const pos = getPos();
            if (pos !== undefined && !editor.isDestroyed && canEditImages(editor) && width !== initial)
              editor.chain().setNodeSelection(pos).updateAttributes('image', { width, height: null }).run();
            else sync();
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
        stopEvent: (event) =>
          event.target === describe ||
          event.target === uploadLegacy ||
          (event.target instanceof HTMLElement && event.target.classList.contains('editor-image-handle')),
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
      ...sourceMetadataAttributes(),
      ...Object.fromEntries(
        ['src', 'alt', 'title'].map((key) => [
          key,
          {
            default: null,
            parseHTML: (element: HTMLElement) => sourceImageAttribute(element, key),
          },
        ]),
      ),
      descriptionPending: { default: false, rendered: false },
      class: {
        default: null,
        parseHTML: (element: HTMLElement) => imageClasses(element.getAttribute('class')),
        renderHTML: (attributes: Record<string, unknown>) => (imageClasses(attributes.class) ? { class: imageClasses(attributes.class) } : {}),
      },
      className: {
        default: null,
        parseHTML: (element: HTMLElement) => imageClasses(element.getAttribute('className')),
        renderHTML: (attributes: Record<string, unknown>) =>
          imageClasses(attributes.className) ? { class: imageClasses(attributes.className) } : {},
      },
      ...Object.fromEntries(
        ['width', 'height'].map((key) => [
          key,
          {
            default: null,
            parseHTML: (element: HTMLElement) => imageDimension(element.getAttribute(key)),
            renderHTML: (attributes: Record<string, unknown>) => (imageDimension(attributes[key]) ? { [key]: imageDimension(attributes[key]) } : {}),
          },
        ]),
      ),
    };
  },
  addStorage() {
    return {
      markdown: {
        serialize(state, node) {
          const legacy = node.type.name === 'legacyImage';
          if (String(node.attrs.src).startsWith(IMAGE_UPLOAD_PLACEHOLDER_PREFIX)) {
            state.write(escapeImageAttribute(state.esc(String(node.attrs.alt ?? '').replace(/[\r\n]+/g, ' '))));
            state.closeBlock(node);
            return;
          }
          if (!legacy && !allowedURL(String(node.attrs.src ?? ''), ['http', 'https'])) {
            state.write(escapeImageAttribute(state.esc(String(node.attrs.alt ?? ''))));
            state.closeBlock(node);
            return;
          }
          if (node.attrs.sourceOpen && !(legacy && node.attrs.markdownSyntax)) {
            state.write(safeImageTag(String(node.attrs.sourceOpen), node.attrs, legacy));
          } else if (node.attrs.width || node.attrs.height || node.attrs.class || node.attrs.className || /[\s"<>]/.test(String(node.attrs.src))) {
            const attributes = imageAttributeNames
              .filter((key) => key === 'alt' || (node.attrs[key] !== null && node.attrs[key] !== undefined))
              .map((key) => `${key}="${escapeImageAttribute(node.attrs[key])}"`);
            state.write(safeImageTag(`<img ${attributes.join(' ')} />`));
          } else {
            const src = String(node.attrs.src ?? '').replace(/[\\()]/g, '\\$&');
            const title = node.attrs.title
              ? ` "${String(node.attrs.title)
                  .replace(/[\r\n]+/g, ' ')
                  .replace(/[\\"]/g, '\\$&')}"`
              : '';
            state.write(`![${state.esc(String(node.attrs.alt ?? '').replace(/[\r\n]+/g, ' '))}](${src}${title})`);
          }
          state.closeBlock(node);
        },
        parse: {
          setup: setupImageSource,
          updateDOM: snapshotImageSource,
        },
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
          if (transactions.some((tr) => tr.getMeta('image-auto-prompt') === false)) return null;
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
          const inserted: number[] = [];
          state.doc.descendants((node, pos) => {
            if (node.type.name !== 'image') return;
            count++;
            if (!previous.has(node)) inserted.push(pos);
          });
          const clipboard = transactions.some((tr) => ['paste', 'drop'].includes(tr.getMeta('uiEvent')));
          const insertedAt = inserted[0];
          if (inserted.length !== 1 || insertedAt === undefined || (count <= previous.size && !clipboard)) return null;
          return state.tr.setSelection(NodeSelection.create(state.doc, insertedAt)).setMeta(imagePromptKey, true);
        },
      }),
    ];
  },
});

/** Source-only compatibility: saved inline images remain visible and lossless.
 * The ordinary image node has allowBase64:false; clipboard handling uploads or
 * rejects legacy nodes before they can be inserted as new inline data images. */
export const LegacyImage = BlockImage.extend({
  name: 'legacyImage',
  addCommands() {
    return {};
  },
  addAttributes() {
    return {
      ...this.parent?.(),
      markdownSyntax: {
        default: false,
        rendered: false,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-nibleaf-markdown-image') === 'true',
      },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'img[data-nibleaf-legacy="true"]',
        getAttrs: (element) => (isLegacyImageSource(element.getAttribute('src') ?? '') ? null : false),
      },
    ];
  },
  addProseMirrorPlugins() {
    return [];
  },
});
