import { translateFn } from '@nibleaf/i18n';
import { presignAssetBody } from '@nibleaf/validators';
import { type Editor, Extension } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { ReactRenderer } from '@tiptap/react';
import { toast } from 'sonner';
import { ImageUploadCard, type ImageUploadCardProps } from './image-upload-card';

export type ImageUploader = (file: File, onProgress?: (percent: number) => void) => Promise<string | null>;

const uploadKey = new PluginKey<DecorationSet>('image-upload');
export const ImageUpload = Extension.create({
  name: 'imageUpload',
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: uploadKey,
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
                    const renderer = new ReactRenderer(ImageUploadCard, { editor, props: action.props, as: 'span' });
                    action.job.renderer = renderer;
                    return renderer.element;
                  },
                  {
                    id: action.id,
                    destroy: () => {
                      action.job.renderer?.destroy();
                      action.job.renderer = undefined;
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
export async function uploadEditorImage(editor: Editor, file: File, upload: ImageUploader, position = editor.state.selection.from) {
  if (!presignAssetBody.safeParse({ filename: file.name, contentType: file.type, size: file.size }).success) {
    toast.error(translateFn(file.size > 50 * 1024 * 1024 ? 'editor.image.tooLarge' : 'editor.image.wrongType'));
    return;
  }
  const id = {};
  const job: { renderer?: ReactRenderer<unknown, ImageUploadCardProps> } = {};
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
    retry: () => {
      props.retrying = true;
      void run();
    },
    remove: () => {
      if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(uploadKey, { remove: true, id }));
    },
  };
  const render = () => job.renderer?.updateProps({ ...props });
  let running = false;
  const run = async () => {
    if (running || !anchor()) return;
    running = true;
    props.failed = false;
    props.progress = null;
    render();
    try {
      const url = await upload(file, (percent) => {
        if (!anchor() || !Number.isFinite(percent)) return;
        props.progress = Math.max(0, Math.min(100, percent));
        render();
      });
      const point = anchor();
      if (!point) return;
      const image = editor.schema.nodes.image;
      if (!url || !image) throw new Error('Upload did not return an image URL');
      editor.view.dispatch(
        closeHistory(editor.state.tr)
          .insert(point.from, image.create({ src: url }))
          .setMeta(uploadKey, { remove: true, id }),
      );
    } catch {
      if (anchor()) {
        props.failed = true;
        render();
      }
    } finally {
      running = false;
      props.retrying = false;
      if (anchor()) render();
    }
  };
  editor.view.dispatch(editor.state.tr.setMeta(uploadKey, { add: true, id, pos: position, props: { ...props }, job }));
  await run();
}
