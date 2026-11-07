import { Code2 } from 'lucide-react';
import type { SlashItem } from './types';

export const fieldSlashItems: SlashItem[] = [
  {
    titleKey: 'editor.slash.paramField.title',
    descKey: 'editor.slash.paramField.desc',
    icon: Code2,
    glyph: '𝑝',
    keywords: ['param', 'parameter', 'api', 'field', 'request'],
    command: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: 'mdxParamField', attrs: { name: 'id', type: 'string' }, content: [{ type: 'paragraph' }] })
        .run(),
  },
  {
    titleKey: 'editor.slash.responseField.title',
    descKey: 'editor.slash.responseField.desc',
    icon: Code2,
    glyph: '𝑟',
    keywords: ['response', 'api', 'field', 'return'],
    command: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: 'mdxResponseField', attrs: { name: 'id', type: 'string' }, content: [{ type: 'paragraph' }] })
        .run(),
  },
];
