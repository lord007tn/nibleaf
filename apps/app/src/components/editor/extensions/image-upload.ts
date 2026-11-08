import { translateFn } from '@nibleaf/i18n';
import { presignAssetBody } from '@nibleaf/validators';
import { type Editor, Extension } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { ReactRenderer } from '@tiptap/react';
import { toast } from 'sonner';
import { announce } from '../../site/reader-content-controls';
import { ImageUploadCard, type ImageUploadCardProps } from './image-upload-card';

/** A recorded upload. `discard` deletes the file again when the writer removes
 *  its card before the image was placed (the server keeps a file saved content uses). */
export type UploadedImage = { url: string; discard?: () => Promise<unknown> };
export type ImageUploader = (
  file: File,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
  onFinishing?: () => void,
) => Promise<string | UploadedImage | null>;
export function canEditImages(editor: Editor): boolean {
  return (
    !editor.isDestroyed &&
    editor.isEditable &&
    (editor.extensionManager.extensions.find((extension) => extension.name === 'imageUpload')?.options.canEdit?.() ?? true)
  );
}
const uploadJobs = new WeakMap<Editor, Set<{ render: () => void; abort: () => void }>>();

const uploadKey = new PluginKey<DecorationSet>('image-upload');
/** The uploader the editor was given, if any (none in read-only previews). */
export function editorImageUploader(editor: Editor): ImageUploader | undefined {
  return editor.extensionManager.extensions.find((extension) => extension.name === 'imageUpload')?.options.getUpload?.();
}
export const ImageUpload = Extension.create<{ canEdit: () => boolean; getUpload: () => ImageUploader | undefined }>({
  name: 'imageUpload',
  addOptions: () => ({ canEdit: () => true, getUpload: () => undefined }),
  onDestroy() {
    for (const job of uploadJobs.get(this.editor) ?? []) job.abort();
    uploadJobs.delete(this.editor);
  },
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: uploadKey,
        filterTransaction: (tr) => !tr.docChanged || tr.getMeta('preventUpdate') || canEditImages(editor),
        view: () => ({
          update: () => {
            for (const job of uploadJobs.get(editor) ?? []) job.render();
          },
        }),
        state: {
          init: () => DecorationSet.empty,
          apply(tr, previous) {
            let decorations = tr.docChanged && tr.getMeta('preventUpdate') ? DecorationSet.empty : previous.map(tr.mapping, tr.doc);
            const action = tr.getMeta(uploadKey);
            if (action?.add)
              decorations = decorations.add(tr.doc, [
                Decoration.widget(
                  action.pos,
                  () => {
                    const renderer = new ReactRenderer(ImageUploadCard, { editor, props: { ...action.props }, as: 'span' });
                    action.job.renderers.set(renderer.element, renderer);
                    action.job.renderer = renderer;
                    return renderer.element;
                  },
                  {
                    id: action.id,
                    destroy: (dom) => {
                      const renderer = action.job.renderers.get(dom);
                      renderer?.destroy();
                      action.job.renderers.delete(dom);
                      if (action.job.renderer === renderer) action.job.renderer = undefined;
                    },
                  },
                ),
              ]);
            if (action?.remove) decorations = decorations.remove(decorations.find().filter((item) => item.spec.id === action.id));
            return decorations;
          },
        },
        props: { decorations: (state) => uploadKey.getState(state) },
      }),
    ];
  },
});

/** The attributes an image keeps when it moves from an inline source to a hosted file. */
const keptImageAttributes = ['alt', 'title', 'width', 'height', 'class', 'className'] as const;

/** Track the insertion point through edits while the network request is pending.
 *  With `replaceLegacySource`, the card sits on that inline (base64) image and a
 *  finished upload swaps it for the hosted file, keeping its description, size
 *  and light/dark classes; Remove or a failure leaves the original in place. */
export async function uploadEditorImage(
  editor: Editor,
  file: File,
  upload: ImageUploader,
  position = editor.state.selection.from,
  attributes: Record<string, unknown> = {},
  replaceLegacySource?: string,
) {
  if (!canEditImages(editor)) return;
  if (!presignAssetBody.safeParse({ filename: file.name, contentType: file.type, size: file.size }).success) {
    toast.error(translateFn(file.size > 50 * 1024 * 1024 ? 'editor.image.tooLarge' : 'editor.image.wrongType'));
    return;
  }
  const id = {};
  const job: { renderer?: ReactRenderer<unknown, ImageUploadCardProps>; renderers: Map<Node, ReactRenderer<unknown, ImageUploadCardProps>> } = {
    renderers: new Map(),
  };
  let controller: AbortController | undefined;
  let timedOut = false;
  let removed = false;
  // A file recorded in this session that is not in the document yet.
  let unplaced: UploadedImage | undefined;
  const discard = (uploaded: UploadedImage | undefined) => {
    if (uploaded?.discard) void uploaded.discard().catch(() => undefined);
  };
  const anchor = () =>
    editor.isDestroyed
      ? undefined
      : uploadKey
          .getState(editor.state)
          ?.find()
          .find((item) => item.spec.id === id);
  const props: ImageUploadCardProps = {
    filename: file.name,
    failed: false,
    retrying: false,
    progress: null,
    finishing: false,
    timedOut: false,
    editable: canEditImages(editor),
    retry: () => {
      if (running || !canEditImages(editor)) return;
      props.retrying = true;
      void run();
    },
    remove: () => {
      if (!canEditImages(editor)) return;
      removed = true;
      controller?.abort();
      editor.view.dispatch(editor.state.tr.setMeta(uploadKey, { remove: true, id }));
      cleanup();
      discard(unplaced);
      unplaced = undefined;
    },
  };
  const render = () => {
    props.editable = canEditImages(editor);
    job.renderer?.updateProps({ ...props });
  };
  const tracked = { render, abort: () => controller?.abort() };
  const jobs = uploadJobs.get(editor) ?? new Set();
  uploadJobs.set(editor, jobs);
  jobs.add(tracked);
  const cleanup = () => {
    jobs.delete(tracked);
  };
  let running = false;
  const run = async () => {
    if (running || !anchor() || !canEditImages(editor)) return;
    running = true;
    props.failed = false;
    props.finishing = false;
    props.timedOut = false;
    timedOut = false;
    controller = new AbortController();
    props.progress = null;
    render();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    try {
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          controller?.abort();
          reject(new Error('Upload timed out'));
        }, 120_000);
      });
      const cancelled = new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(new DOMException('Upload cancelled', 'AbortError'));
        controller?.signal.addEventListener('abort', onAbort, { once: true });
      });
      const uploading = upload(
        file,
        (percent) => {
          if (!anchor() || !Number.isFinite(percent)) return;
          props.progress = Math.max(0, Math.min(99, percent));
          render();
        },
        controller.signal,
        () => {
          props.finishing = true;
          props.progress = null;
          render();
        },
      );
      // A confirmation that still lands after Remove leaves nothing behind either.
      uploading.then(
        (late) => {
          if (removed && late && typeof late === 'object') discard(late);
        },
        () => undefined,
      );
      const result = await Promise.race([timeout, cancelled, uploading]);
      if (result && typeof result === 'object') unplaced = result;
      const url = typeof result === 'string' ? result : result?.url;
      const point = anchor();
      if (!point) return;
      if (!canEditImages(editor)) throw new Error('Editing is disabled');
      const image = editor.schema.nodes.image;
      if (!url || !image) throw new Error('Upload did not return an image URL');
      if (replaceLegacySource !== undefined) {
        const legacy = editor.state.doc.nodeAt(point.from);
        // The writer deleted or replaced the inline image meanwhile: nothing to swap.
        if (legacy?.type.name !== 'legacyImage' || legacy.attrs.src !== replaceLegacySource) {
          editor.view.dispatch(editor.state.tr.setMeta(uploadKey, { remove: true, id }));
          discard(unplaced);
          unplaced = undefined;
          cleanup();
          return;
        }
        const kept = Object.fromEntries(keptImageAttributes.map((key) => [key, legacy.attrs[key] ?? null]));
        editor.view.dispatch(
          closeHistory(editor.state.tr)
            .replaceWith(point.from, point.from + legacy.nodeSize, image.create({ ...kept, src: url, descriptionPending: !kept.alt }))
            .setMeta('image-auto-prompt', false)
            .setMeta(uploadKey, { remove: true, id }),
        );
        unplaced = undefined;
        announce(translateFn('editor.image.legacyUploaded', { filename: String(kept.alt || file.name) }));
        cleanup();
        return;
      }
      editor.view.dispatch(
        closeHistory(editor.state.tr)
          .insert(point.from, image.create({ ...attributes, src: url, descriptionPending: true }))
          .setMeta('image-auto-prompt', false)
          .setMeta(uploadKey, { remove: true, id }),
      );
      unplaced = undefined;
      announce(`${file.name}. ${translateFn('editor.image.descriptionHint')}`);
      cleanup();
    } catch {
      if (anchor()) {
        props.failed = true;
        props.timedOut = timedOut;
        render();
      }
    } finally {
      clearTimeout(timer);
      if (onAbort) controller?.signal.removeEventListener('abort', onAbort);
      if (!anchor()) cleanup();
      running = false;
      props.retrying = false;
      if (anchor()) render();
    }
  };
  editor.view.dispatch(editor.state.tr.setMeta(uploadKey, { add: true, id, pos: position, props, job }));
  await run();
}
