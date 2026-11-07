import { Sparkles } from 'lucide-react';
import type { SlashItem } from './types';

export const iconSlashItems: SlashItem[] = [
  {
    titleKey: 'editor.slash.icon.title',
    descKey: 'editor.slash.icon.desc',
    icon: Sparkles,
    glyph: '✦',
    keywords: ['icon', 'glyph', 'symbol', 'inline'],
    // A self-closing inline Icon atom.
    command: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: 'mdxIcon', attrs: { icon: 'star' } })
        .run(),
  },
];
