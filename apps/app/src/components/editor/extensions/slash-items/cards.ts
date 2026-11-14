import type { Locale } from '@nibleaf/i18n';
import { LayoutGrid } from 'lucide-react';
import { insertBlockAtFirstItem } from './insert-items';
import { type SlashItem, scaffoldText } from './types';

const cardContent = (count: number, locale: Locale) =>
  Array.from({ length: count }, (_, index) => ({
    type: 'mdxCard',
    attrs: { title: scaffoldText('editor.slash.default.cardN', locale, { n: index + 1 }) },
    content: [{ type: 'paragraph' }],
  }));

export const cardSlashItems: SlashItem[] = [
  {
    titleKey: 'editor.slash.card.title',
    descKey: 'editor.slash.card.desc',
    icon: LayoutGrid,
    glyph: '□',
    keywords: ['card', 'link', 'resource'],
    command: ({ editor, range, locale }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: 'mdxCard',
          attrs: { title: scaffoldText('editor.slash.default.cardTitle', locale), href: '' },
          content: [{ type: 'paragraph' }],
        })
        .run(),
  },
  {
    titleKey: 'editor.slash.cardGroup.title',
    descKey: 'editor.slash.cardGroup.desc',
    icon: LayoutGrid,
    glyph: '▦',
    keywords: ['card', 'cards', 'grid', 'tiles'],
    command: ({ editor, range, locale }) =>
      insertBlockAtFirstItem(editor, range, {
        type: 'mdxCardGroup',
        attrs: { cols: '2' },
        content: cardContent(2, locale),
      }),
  },
  ...([3, 4] as const).map(
    (count): SlashItem => ({
      titleKey: count === 3 ? 'editor.slash.cardGrid3.title' : 'editor.slash.cardGrid4.title',
      descKey: count === 3 ? 'editor.slash.cardGrid3.desc' : 'editor.slash.cardGrid4.desc',
      icon: LayoutGrid,
      glyph: `▦${count}`,
      keywords: ['card', 'cards', 'grid', 'tiles'],
      command: ({ editor, range, locale }) =>
        insertBlockAtFirstItem(editor, range, { type: 'mdxCardGroup', attrs: { cols: String(count) }, content: cardContent(count, locale) }),
    }),
  ),
];
