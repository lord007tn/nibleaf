import { MessageCircle } from 'lucide-react';
import { type SlashItem, scaffoldText } from './types';

export const tooltipSlashItems: SlashItem[] = [
  {
    titleKey: 'editor.slash.tooltip.title',
    descKey: 'editor.slash.tooltip.desc',
    icon: MessageCircle,
    glyph: '?',
    keywords: ['tooltip', 'hint', 'hover', 'inline'],
    // An inline Tooltip wrapping the current selection (or placeholder text).
    command: ({ editor, range, locale }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: 'mdxTooltip',
          attrs: { tip: scaffoldText('editor.slash.default.tooltipText', locale) },
          content: [{ type: 'text', text: scaffoldText('editor.slash.default.term', locale) }],
        })
        .run(),
  },
];
