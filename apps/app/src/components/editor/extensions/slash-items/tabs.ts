import { AppWindow } from 'lucide-react';
import { type SlashItem, scaffoldText } from './types';

export const tabsSlashItems: SlashItem[] = [
  {
    titleKey: 'editor.slash.tabs.title',
    descKey: 'editor.slash.tabs.desc',
    icon: AppWindow,
    glyph: '⊟',
    keywords: ['tab', 'tabs', 'panes'],
    command: ({ editor, range, locale }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: 'mdxTabs',
          content: [
            { type: 'mdxTab', attrs: { title: scaffoldText('editor.slash.default.firstTab', locale) }, content: [{ type: 'paragraph' }] },
            { type: 'mdxTab', attrs: { title: scaffoldText('editor.slash.default.secondTab', locale) }, content: [{ type: 'paragraph' }] },
          ],
        })
        .run(),
  },
];
