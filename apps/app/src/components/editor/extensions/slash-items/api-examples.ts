import { Braces, Inbox, Send } from 'lucide-react';
import { insertBlockAtFirstItem } from './insert-items';
import type { SlashItem } from './types';

export const apiExampleSlashItems: SlashItem[] = [
  {
    titleKey: 'editor.slash.apiExample.title',
    descKey: 'editor.slash.apiExample.desc',
    icon: Braces,
    glyph: '{}',
    keywords: ['api', 'request', 'response', 'example'],
    command: ({ editor, range }) =>
      insertBlockAtFirstItem(editor, range, {
        type: 'mdxApiExample',
        attrs: { title: '' },
        content: [
          { type: 'mdxRequestExample', attrs: { title: '' }, content: [{ type: 'paragraph' }] },
          { type: 'mdxResponseExample', attrs: { title: '', status: '' }, content: [{ type: 'paragraph' }] },
        ],
      }),
  },
  {
    titleKey: 'editor.slash.requestExample.title',
    descKey: 'editor.slash.requestExample.desc',
    icon: Send,
    glyph: '→',
    keywords: ['api', 'request', 'example'],
    command: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: 'mdxRequestExample', attrs: { title: '' }, content: [{ type: 'paragraph' }] })
        .run(),
  },
  {
    titleKey: 'editor.slash.responseExample.title',
    descKey: 'editor.slash.responseExample.desc',
    icon: Inbox,
    glyph: '←',
    keywords: ['api', 'response', 'example'],
    command: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: 'mdxResponseExample', attrs: { title: '', status: '' }, content: [{ type: 'paragraph' }] })
        .run(),
  },
];
