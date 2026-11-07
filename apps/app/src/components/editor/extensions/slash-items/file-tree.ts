import { FileText, Folder, FolderTree } from 'lucide-react';
import type { SlashItem } from './types';

export const fileTreeSlashItems: SlashItem[] = [
  {
    titleKey: 'editor.slash.fileTree.title',
    descKey: 'editor.slash.fileTree.desc',
    icon: FolderTree,
    glyph: '⌘',
    keywords: ['file', 'folder', 'tree', 'structure'],
    command: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: 'mdxFileTree',
          content: [{ type: 'mdxFile', attrs: { name: '', icon: '' } }],
        })
        .run(),
  },
  {
    titleKey: 'editor.slash.folder.title',
    descKey: 'editor.slash.folder.desc',
    icon: Folder,
    glyph: '▸',
    keywords: ['folder', 'directory', 'tree'],
    command: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: 'mdxFolder', attrs: { name: '' }, content: [{ type: 'paragraph' }] })
        .run(),
  },
  {
    titleKey: 'editor.slash.file.title',
    descKey: 'editor.slash.file.desc',
    icon: FileText,
    glyph: '⌑',
    keywords: ['file', 'document', 'tree'],
    command: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: 'mdxFile', attrs: { name: '', icon: '' } })
        .run(),
  },
];
