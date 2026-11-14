import { Code2 } from 'lucide-react';
import { insertBlockAtFirstItem } from './insert-items';
import type { SlashItem } from './types';

export const codeGroupSlashItems: SlashItem[] = [
  {
    titleKey: 'editor.slash.codeGroup.title',
    descKey: 'editor.slash.codeGroup.desc',
    icon: Code2,
    glyph: '❐',
    keywords: ['code', 'group', 'tabs', 'languages'],
    command: ({ editor, range }) =>
      insertBlockAtFirstItem(editor, range, { type: 'mdxCodeGroup', content: [{ type: 'codeBlock', attrs: { language: 'bash' } }] }),
  },
];
