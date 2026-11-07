import { Code2 } from 'lucide-react';
import type { SlashItem } from './types';

export const codeGroupSlashItems: SlashItem[] = [
  {
    titleKey: 'editor.slash.codeGroup.title',
    descKey: 'editor.slash.codeGroup.desc',
    icon: Code2,
    glyph: '❐',
    keywords: ['code', 'group', 'tabs', 'languages'],
    command: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: 'mdxCodeGroup', content: [{ type: 'codeBlock', attrs: { language: 'bash' } }] })
        .run(),
  },
];
