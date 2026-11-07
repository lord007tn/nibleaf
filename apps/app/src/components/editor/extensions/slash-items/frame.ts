import { Frame as FrameIcon } from 'lucide-react';
import type { SlashItem } from './types';

export const frameSlashItems: SlashItem[] = [
  {
    titleKey: 'editor.slash.frame.title',
    descKey: 'editor.slash.frame.desc',
    icon: FrameIcon,
    glyph: '▣',
    keywords: ['frame', 'figure', 'screenshot', 'caption'],
    command: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: 'mdxFrame', attrs: { caption: '' }, content: [{ type: 'paragraph' }] })
        .run(),
  },
];
