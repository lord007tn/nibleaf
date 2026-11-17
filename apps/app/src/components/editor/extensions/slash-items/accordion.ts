import { ListCollapse } from 'lucide-react';
import { insertBlockAtFirstItem } from './insert-items';
import { type SlashItem, scaffoldText } from './types';

export const accordionSlashItems: SlashItem[] = [
  {
    titleKey: 'editor.slash.accordion.title',
    descKey: 'editor.slash.accordion.desc',
    icon: ListCollapse,
    glyph: '▾',
    keywords: ['accordion', 'collapse', 'expand', 'faq', 'toggle'],
    command: ({ editor, range, locale }) =>
      insertBlockAtFirstItem(editor, range, {
        type: 'mdxAccordionGroup',
        content: [
          {
            type: 'mdxAccordion',
            attrs: { title: scaffoldText('editor.slash.default.firstSection', locale) },
            content: [{ type: 'paragraph' }],
          },
          {
            type: 'mdxAccordion',
            attrs: { title: scaffoldText('editor.slash.default.secondSection', locale) },
            content: [{ type: 'paragraph' }],
          },
        ],
      }),
  },
];
