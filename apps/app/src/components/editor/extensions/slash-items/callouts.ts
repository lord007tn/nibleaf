import { CircleCheck, Info, Lightbulb, OctagonAlert, TriangleAlert } from 'lucide-react';
import type { SlashItem } from './types';

/** Every variant answers to "callout" (English and Arabic), so "/call" lists Note too. */
const CALLOUT_KEYWORDS = ['callout', 'admonition', 'تنبيه'];

/** Callout variants (the `callout` extension). */
export const calloutSlashItems: SlashItem[] = [
  {
    titleKey: 'editor.slash.note.title',
    descKey: 'editor.slash.note.desc',
    icon: Lightbulb,
    glyph: '!',
    // Main's aliases stay ("/warning" and "/info" still offer Note, below the exact Warning and Info).
    keywords: [...CALLOUT_KEYWORDS, 'note', 'warning', 'info', 'remark', 'aside'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setCallout({ variant: 'note' }).run(),
  },
  {
    titleKey: 'editor.slash.info.title',
    descKey: 'editor.slash.info.desc',
    icon: Info,
    glyph: 'i',
    keywords: [...CALLOUT_KEYWORDS, 'information', 'important'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setCallout({ variant: 'info' }).run(),
  },
  {
    titleKey: 'editor.slash.tip.title',
    descKey: 'editor.slash.tip.desc',
    icon: Lightbulb,
    glyph: '✦',
    keywords: [...CALLOUT_KEYWORDS, 'hint', 'recommendation'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setCallout({ variant: 'tip' }).run(),
  },
  {
    titleKey: 'editor.slash.check.title',
    descKey: 'editor.slash.check.desc',
    icon: CircleCheck,
    glyph: '✓',
    keywords: [...CALLOUT_KEYWORDS, 'success', 'done'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setCallout({ variant: 'check' }).run(),
  },
  {
    titleKey: 'editor.slash.warning.title',
    descKey: 'editor.slash.warning.desc',
    icon: TriangleAlert,
    glyph: '△',
    keywords: [...CALLOUT_KEYWORDS, 'caution', 'alert'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setCallout({ variant: 'warning' }).run(),
  },
  {
    titleKey: 'editor.slash.danger.title',
    descKey: 'editor.slash.danger.desc',
    icon: OctagonAlert,
    glyph: '!',
    keywords: [...CALLOUT_KEYWORDS, 'danger', 'destructive'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setCallout({ variant: 'danger' }).run(),
  },
];
