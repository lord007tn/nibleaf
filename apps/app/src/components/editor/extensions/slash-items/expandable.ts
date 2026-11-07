import { ListCollapse } from 'lucide-react';
import { type SlashItem, scaffoldText } from './types';

export const expandableSlashItems: SlashItem[] = [
  {
    titleKey: 'editor.slash.expandable.title',
    descKey: 'editor.slash.expandable.desc',
    icon: ListCollapse,
    glyph: '⊕',
    keywords: ['expandable', 'collapse', 'disclosure', 'details'],
    command: ({ editor, range, locale }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: 'mdxExpandable',
          attrs: { title: scaffoldText('editor.slash.default.showDetails', locale) },
          content: [{ type: 'paragraph' }],
        })
        .run(),
  },
];
