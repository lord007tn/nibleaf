import { translateFn } from '@nibleaf/i18n/react';
import type { Editor } from '@tiptap/core';
import { Image as ImageIcon, Table as TableIcon } from 'lucide-react';
import { uploadEditorImage } from '../image-upload';
import type { SlashItem, UploadFn } from './types';

/** Open a native file picker, upload the chosen image, and insert it. Falls back
 *  to a URL prompt when no uploader is wired. */
function insertImage(editor: Editor, onUpload?: UploadFn) {
  if (!onUpload) {
    const url = window.prompt(translateFn('editor.slash.imageUrlPrompt'));
    if (url) {
      editor.chain().focus().setImage({ src: url }).run();
    }
    return;
  }
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    void uploadEditorImage(editor, file, onUpload);
  };
  document.body.appendChild(input);
  input.hidden = true;
  input.addEventListener('change', () => input.remove(), { once: true });
  input.addEventListener('cancel', () => input.remove(), { once: true });
  input.click();
}

/** Images and tables. */
export const mediaSlashItems = (onUpload?: UploadFn): SlashItem[] => [
  {
    titleKey: 'editor.slash.image.title',
    descKey: 'editor.slash.image.desc',
    icon: ImageIcon,
    glyph: '🖼',
    keywords: ['picture', 'photo', 'img', 'upload'],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run();
      insertImage(editor, onUpload);
    },
  },
  {
    titleKey: 'editor.slash.table.title',
    descKey: 'editor.slash.table.desc',
    icon: TableIcon,
    glyph: '⊞',
    keywords: ['grid', 'rows', 'columns'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
];
