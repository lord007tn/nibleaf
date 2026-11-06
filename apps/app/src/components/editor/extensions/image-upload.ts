import { translateFn } from '@nibleaf/i18n';
import { presignAssetBody } from '@nibleaf/validators';
import { type Editor, Extension } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { toast } from 'sonner';

const uploadKey = new PluginKey<DecorationSet>('image-upload');
export const ImageUpload = Extension.create({
  name: 'imageUpload',
  addProseMirrorPlugins() {
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
                    const node = document.createElement('span');
                    node.className = 'rounded border border-border bg-muted px-3 py-2 text-sm';
                    node.setAttribute('role', 'status');
                    node.textContent = action.label;
                    return node;
                  },
                  { id: action.id },
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
  upload: (file: File) => Promise<string | null>,
  position = editor.state.selection.from,
) {
  if (!presignAssetBody.safeParse({ filename: file.name, contentType: file.type, size: file.size }).success) {
    toast.error(translateFn(file.size > 50 * 1024 * 1024 ? 'editor.image.tooLarge' : 'editor.image.wrongType'));
    return;
  }
  const id = {};
  editor.view.dispatch(editor.state.tr.setMeta(uploadKey, { add: true, id, pos: position, label: translateFn('editor.image.uploading') }));
  try {
    const url = await upload(file);
    if (editor.isDestroyed) return;
    const anchor = uploadKey
      .getState(editor.state)
      ?.find()
      .find((item) => item.spec.id === id);
    const image = editor.schema.nodes.image;
    if (url && anchor && image) {
      editor.view.dispatch(
        closeHistory(editor.state.tr)
          .insert(anchor.from, image.create({ src: url }))
          .setMeta(uploadKey, { remove: true, id }),
      );
    }
  } catch {
    if (!editor.isDestroyed) toast.error(translateFn('editor.imageUploadFailed'));
  } finally {
    if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(uploadKey, { remove: true, id }));
  }
}
