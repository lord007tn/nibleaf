import { ListChecks } from 'lucide-react';
import { type SlashItem, scaffoldText } from './types';

export const stepsSlashItems: SlashItem[] = [
  {
    titleKey: 'editor.slash.steps.title',
    descKey: 'editor.slash.steps.desc',
    icon: ListChecks,
    glyph: '№',
    keywords: ['steps', 'guide', 'procedure', 'tutorial', 'how-to'],
    command: ({ editor, range, locale }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: 'mdxSteps',
          content: [
            { type: 'mdxStep', attrs: { title: scaffoldText('editor.slash.default.firstStep', locale) }, content: [{ type: 'paragraph' }] },
            { type: 'mdxStep', attrs: { title: scaffoldText('editor.slash.default.secondStep', locale) }, content: [{ type: 'paragraph' }] },
          ],
        })
        .run(),
  },
];
