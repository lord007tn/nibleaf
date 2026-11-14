import { BookOpen } from 'lucide-react';
import { insertBlockAtFirstItem } from './insert-items';
import type { SlashItem } from './types';

export const relatedSlashItems: SlashItem[] = [
  {
    titleKey: 'editor.slash.relatedContent.title',
    descKey: 'editor.slash.relatedContent.desc',
    icon: BookOpen,
    glyph: '↗',
    keywords: ['related', 'content', 'navigation', 'resources'],
    command: ({ editor, range }) =>
      insertBlockAtFirstItem(editor, range, {
        type: 'mdxRelatedContent',
        attrs: { title: '' },
        content: [
          {
            type: 'mdxRelatedCard',
            attrs: { title: '', description: '', href: '', icon: '' },
            content: [{ type: 'paragraph' }],
          },
        ],
      }),
  },
  {
    titleKey: 'editor.slash.relatedCard.title',
    descKey: 'editor.slash.relatedCard.desc',
    icon: BookOpen,
    glyph: '◇',
    keywords: ['related', 'card', 'link', 'resource'],
    command: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: 'mdxRelatedCard',
          attrs: { title: '', description: '', href: '', icon: '' },
          content: [{ type: 'paragraph' }],
        })
        .run(),
  },
];
