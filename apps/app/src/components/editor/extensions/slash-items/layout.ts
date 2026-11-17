import type { Locale } from '@nibleaf/i18n';
import { Badge as BadgeIcon, Columns3, MousePointerClick, PanelTop } from 'lucide-react';
import { insertBlockAtFirstItem } from './insert-items';
import { type SlashItem, scaffoldText } from './types';

const columnContent = (count: number, locale: Locale) =>
  Array.from({ length: count }, (_, index) => ({
    type: 'mdxColumn',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: scaffoldText('editor.slash.default.columnN', locale, { n: index + 1 }) }] }],
  }));

export const layoutSlashItems: SlashItem[] = [
  {
    titleKey: 'editor.slash.columns2.title',
    descKey: 'editor.slash.columns2.desc',
    icon: Columns3,
    glyph: '▥',
    keywords: ['columns', 'layout', 'grid'],
    command: ({ editor, range, locale }) =>
      insertBlockAtFirstItem(editor, range, {
        type: 'mdxColumns',
        content: columnContent(2, locale),
      }),
  },
  ...([3, 4] as const).map(
    (count): SlashItem => ({
      titleKey: count === 3 ? 'editor.slash.columns3.title' : 'editor.slash.columns4.title',
      descKey: count === 3 ? 'editor.slash.columns3.desc' : 'editor.slash.columns4.desc',
      icon: Columns3,
      glyph: `▥${count}`,
      keywords: ['columns', 'layout', 'grid'],
      command: ({ editor, range, locale }) => insertBlockAtFirstItem(editor, range, { type: 'mdxColumns', content: columnContent(count, locale) }),
    }),
  ),
  {
    titleKey: 'editor.slash.banner.title',
    descKey: 'editor.slash.banner.desc',
    icon: PanelTop,
    glyph: '▰',
    keywords: ['banner', 'announcement'],
    command: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: 'mdxBanner', attrs: { type: 'info' }, content: [{ type: 'paragraph' }] })
        .run(),
  },
  {
    titleKey: 'editor.slash.badge.title',
    descKey: 'editor.slash.badge.desc',
    icon: BadgeIcon,
    glyph: '●',
    keywords: ['badge', 'label', 'status'],
    command: ({ editor, range, locale }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: 'mdxBadge', content: [{ type: 'text', text: scaffoldText('editor.slash.default.badge', locale) }] })
        .run(),
  },
  {
    titleKey: 'editor.slash.button.title',
    descKey: 'editor.slash.button.desc',
    icon: MousePointerClick,
    glyph: '↗',
    keywords: ['button', 'cta', 'link', 'action'],
    command: ({ editor, range, locale }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: 'mdxButton',
          attrs: { href: '', variant: 'default' },
          content: [{ type: 'text', text: scaffoldText('editor.slash.default.button', locale) }],
        })
        .run(),
  },
];
