import { ListChecks } from 'lucide-react';
import type { SlashItem } from './types';

export const updateSlashItems: SlashItem[] = [
  {
    titleKey: 'editor.slash.update.title',
    descKey: 'editor.slash.update.desc',
    icon: ListChecks,
    glyph: '✚',
    keywords: ['update', 'changelog', 'release', 'version'],
    command: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: 'mdxUpdate', attrs: { label: 'v1.0.0' }, content: [{ type: 'paragraph' }] })
        .run(),
  },
];
