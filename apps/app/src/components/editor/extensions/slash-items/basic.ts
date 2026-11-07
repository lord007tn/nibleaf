import { Code2, Heading1, Heading2, Heading3, List, ListOrdered, ListTodo, Minus, Quote, Type, Workflow } from 'lucide-react';
import type { SlashItem } from './types';

/** Everyday writing blocks: text, headings, lists, quotes and code. */
export const basicSlashItems: SlashItem[] = [
  {
    titleKey: 'editor.slash.text.title',
    descKey: 'editor.slash.text.desc',
    icon: Type,
    glyph: '¶',
    keywords: ['paragraph', 'p'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setParagraph().run(),
  },
  {
    titleKey: 'editor.slash.h1.title',
    descKey: 'editor.slash.h1.desc',
    icon: Heading1,
    glyph: 'H1',
    keywords: ['h1', 'title'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run(),
  },
  {
    titleKey: 'editor.slash.h2.title',
    descKey: 'editor.slash.h2.desc',
    icon: Heading2,
    glyph: 'H2',
    keywords: ['h2', 'subtitle'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run(),
  },
  {
    titleKey: 'editor.slash.h3.title',
    descKey: 'editor.slash.h3.desc',
    icon: Heading3,
    glyph: 'H3',
    keywords: ['h3'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run(),
  },
  {
    titleKey: 'editor.slash.bulletList.title',
    descKey: 'editor.slash.bulletList.desc',
    icon: List,
    glyph: '•',
    keywords: ['unordered', 'ul', 'bullet'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    titleKey: 'editor.slash.numberedList.title',
    descKey: 'editor.slash.numberedList.desc',
    icon: ListOrdered,
    glyph: '1.',
    keywords: ['ordered', 'ol', 'number'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    titleKey: 'editor.slash.todo.title',
    descKey: 'editor.slash.todo.desc',
    icon: ListTodo,
    glyph: '☐',
    keywords: ['task', 'todo', 'checkbox'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleTaskList().run(),
  },
  {
    titleKey: 'editor.slash.quote.title',
    descKey: 'editor.slash.quote.desc',
    icon: Quote,
    glyph: '"',
    keywords: ['blockquote'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
  {
    titleKey: 'editor.slash.codeBlock.title',
    descKey: 'editor.slash.codeBlock.desc',
    icon: Code2,
    glyph: '<>',
    keywords: ['snippet', 'pre'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
  },
  {
    titleKey: 'editor.slash.mermaid.title',
    descKey: 'editor.slash.mermaid.desc',
    icon: Workflow,
    glyph: '⧉',
    keywords: ['mermaid', 'diagram', 'flowchart', 'sequence', 'graph'],
    // A fenced code block tagged `mermaid` — the live site renders it as an SVG
    // diagram (rehypeMermaid), and it round-trips as ```mermaid in Markdown.
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setCodeBlock({ language: 'mermaid' }).run(),
  },
];

/** Listed after the component blocks, at the end of the Advanced section. */
export const dividerSlashItems: SlashItem[] = [
  {
    titleKey: 'editor.slash.divider.title',
    descKey: 'editor.slash.divider.desc',
    icon: Minus,
    glyph: '—',
    keywords: ['hr', 'separator', 'rule'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
];
