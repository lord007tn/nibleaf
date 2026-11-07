import { translateFn } from '@nibleaf/i18n';
import { presignAssetBody } from '@nibleaf/validators';
import { type Editor, Extension } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { ReactRenderer } from '@tiptap/react';
import { toast } from 'sonner';
import { ImageUploadCard, type ImageUploadCardProps } from './image-upload-card';

export type ImageUploader = (
  file: File,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
  onFinishing?: () => void,
) => Promise<string | null>;
export function canEditImages(editor: Editor): boolean {
  return (
    !editor.isDestroyed &&
    editor.isEditable &&
    (editor.extensionManager.extensions.find((extension) => extension.name === 'imageUpload')?.options.canEdit?.() ?? true)
  );
}
const uploadJobs = new WeakMap<Editor, Set<{ render: () => void; abort: () => void }>>();

const uploadKey = new PluginKey<DecorationSet>('image-upload');
export const ImageUpload = Extension.create<{ canEdit: () => boolean }>({
  name: 'imageUpload',
  addOptions: () => ({ canEdit: () => true }),
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

/** Track the insertion point through edits while the network request is pending. */
export async function uploadEditorImage(
  editor: Editor,
  file: File,
  upload: ImageUploader,
  position = editor.state.selection.from,
  attributes: Record<string, unknown> = {},
  autoPrompt = true,
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
  const initialSelection = editor.state.selection;
  const initiallyFocused = editor.isFocused;
  let changed = false;
  const onTransaction = ({ transaction }: { transaction: import('@tiptap/pm/state').Transaction }) => {
    if (transaction.docChanged || transaction.selectionSet) changed = true;
  };
  editor.on('transaction', onTransaction);
  let controller: AbortController | undefined;
  let timedOut = false;
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
      controller?.abort();
      editor.view.dispatch(editor.state.tr.setMeta(uploadKey, { remove: true, id }));
      cleanup();
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
    editor.off('transaction', onTransaction);
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
      const url = await Promise.race([
        timeout,
        cancelled,
        upload(
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
        ),
      ]);
      const point = anchor();
      if (!point) return;
      if (!canEditImages(editor)) throw new Error('Editing is disabled');
      const image = editor.schema.nodes.image;
      if (!url || !image) throw new Error('Upload did not return an image URL');
      editor.view.dispatch(
        closeHistory(editor.state.tr)
          .insert(point.from, image.create({ ...attributes, src: url }))
          .setMeta('image-auto-prompt', autoPrompt && !changed && initiallyFocused && editor.isFocused && editor.state.selection.eq(initialSelection))
          .setMeta(uploadKey, { remove: true, id }),
      );
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
