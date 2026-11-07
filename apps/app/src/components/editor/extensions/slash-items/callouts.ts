import { CircleCheck, Info, Lightbulb, OctagonAlert, TriangleAlert } from 'lucide-react';
import type { SlashItem } from './types';

/** Callout variants (the `callout` extension). */
export const calloutSlashItems: SlashItem[] = [
  {
    titleKey: 'editor.slash.note.title',
    descKey: 'editor.slash.note.desc',
    icon: Lightbulb,
    glyph: '!',
    keywords: ['note', 'admonition', 'warning', 'info'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setCallout({ variant: 'note' }).run(),
  },
  {
    titleKey: 'editor.slash.info.title',
    descKey: 'editor.slash.info.desc',
    icon: Info,
    glyph: 'i',
    keywords: ['callout', 'information', 'important'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setCallout({ variant: 'info' }).run(),
  },
  {
    titleKey: 'editor.slash.tip.title',
    descKey: 'editor.slash.tip.desc',
    icon: Lightbulb,
    glyph: '✦',
    keywords: ['callout', 'hint', 'recommendation'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setCallout({ variant: 'tip' }).run(),
  },
  {
    titleKey: 'editor.slash.check.title',
    descKey: 'editor.slash.check.desc',
    icon: CircleCheck,
    glyph: '✓',
    keywords: ['callout', 'success', 'done'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setCallout({ variant: 'check' }).run(),
  },
  {
    titleKey: 'editor.slash.warning.title',
    descKey: 'editor.slash.warning.desc',
    icon: TriangleAlert,
    glyph: '△',
    keywords: ['callout', 'caution', 'alert'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setCallout({ variant: 'warning' }).run(),
  },
  {
    titleKey: 'editor.slash.danger.title',
    descKey: 'editor.slash.danger.desc',
    icon: OctagonAlert,
    glyph: '!',
    keywords: ['callout', 'danger', 'destructive'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setCallout({ variant: 'danger' }).run(),
  },
];
