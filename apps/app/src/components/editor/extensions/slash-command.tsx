import { cn } from '@nibleaf/design-system/lib/utils';
import { type Locale, type MessageKey, type MessageVariables, resolveLocale } from '@nibleaf/i18n';
import { translateFn, useLocale } from '@nibleaf/i18n/react';
import type { Editor, Range } from '@tiptap/core';
import { Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import { ReactRenderer } from '@tiptap/react';
import Suggestion, { exitSuggestion, type SuggestionOptions, type SuggestionProps } from '@tiptap/suggestion';
import {
  AppWindow,
  Badge as BadgeIcon,
  BookOpen,
  Braces,
  CircleCheck,
  Code2,
  Columns3,
  FileText,
  Folder,
  FolderTree,
  Frame as FrameIcon,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Inbox,
  Info,
  LayoutGrid,
  Lightbulb,
  List,
  ListChecks,
  ListCollapse,
  ListOrdered,
  ListTodo,
  MessageCircle,
  Minus,
  MousePointerClick,
  OctagonAlert,
  PanelTop,
  Quote,
  Send,
  Sparkles,
  Table as TableIcon,
  TriangleAlert,
  Type,
  Workflow,
} from 'lucide-react';
import type { ComponentType, Ref } from 'react';
import { useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';

interface SlashCommandProps {
  editor: Editor;
  range: Range;
  /** Language of the page being edited — inserted scaffold text follows it, not the dashboard locale. */
  locale: Locale;
}

export interface SlashItem {
  titleKey: MessageKey;
  descKey: MessageKey;
  icon: ComponentType<{ className?: string }>;
  /** Short mono glyph shown in the 32px tile (matches the design's monospace tiles). */
  glyph: string;
  keywords?: string[];
  command: (props: SlashCommandProps) => void;
}

/** Uploads a picked image and returns its hosted URL (or null on failure). */
type UploadFn = (file: File) => Promise<string | null>;

/** Default text for an inserted block, written in the page language (an Arabic
 *  page gets Arabic placeholders whatever the dashboard locale is). */
const scaffoldText = (key: MessageKey, locale: Locale, variables?: MessageVariables): string => translateFn(key, variables, locale);

/** The page language scaffolds are written in: an explicit extension option wins,
 *  then a `lang` on the editor's direction scope (the host's `dir` wrapper), then
 *  that scope's direction — a right-to-left page defaults to Arabic. */
export const scaffoldLocaleOf = (scope: { lang?: string; dir?: string } | null | undefined, explicit?: Locale): Locale => {
  if (explicit) return explicit;
  const fromLang = scope?.lang ? resolveLocale(scope.lang) : null;
  if (fromLang) return fromLang;
  return scope?.dir === 'rtl' ? 'ar' : 'en';
};

/** Resolve the page language for a running editor from its nearest `dir` scope. */
export const slashPageLocale = (editor: Pick<Editor, 'view'>, explicit?: Locale): Locale =>
  scaffoldLocaleOf(editor.view.dom.closest<HTMLElement>('[dir]'), explicit);

const cardContent = (count: number, locale: Locale) =>
  Array.from({ length: count }, (_, index) => ({
    type: 'mdxCard',
    attrs: { title: scaffoldText('editor.slash.default.cardN', locale, { n: index + 1 }) },
    content: [{ type: 'paragraph' }],
  }));

const columnContent = (count: number, locale: Locale) =>
  Array.from({ length: count }, (_, index) => ({
    type: 'mdxColumn',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: scaffoldText('editor.slash.default.columnN', locale, { n: index + 1 }) }] }],
  }));

/** Open a native file picker, upload the chosen image, and insert it. Falls back
 *  to a URL prompt when no uploader is wired. */
function insertImage(editor: Editor, onUpload?: UploadFn) {
  if (!onUpload) {
    const url = window.prompt(translateFn('editor.slash.imageUrlPrompt'));
    if (url) {
      editor.chain().focus().setImage({ src: url }).run();
    }
    return;
  }
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    onUpload(file)
      .then((url) => {
        if (url) {
          editor.chain().focus().setImage({ src: url }).run();
        }
      })
      .catch(() => undefined);
  };
  input.click();
}

export const createSlashItems = (onUpload?: UploadFn): SlashItem[] => [
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
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: 'mdxCardGroup',
          attrs: { cols: '2' },
          content: cardContent(2, locale),
        })
        .run(),
  },
  ...([3, 4] as const).map(
    (count): SlashItem => ({
      titleKey: count === 3 ? 'editor.slash.cardGrid3.title' : 'editor.slash.cardGrid4.title',
      descKey: count === 3 ? 'editor.slash.cardGrid3.desc' : 'editor.slash.cardGrid4.desc',
      icon: LayoutGrid,
      glyph: `▦${count}`,
      keywords: ['card', 'cards', 'grid', 'tiles'],
      command: ({ editor, range, locale }) =>
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertContent({ type: 'mdxCardGroup', attrs: { cols: String(count) }, content: cardContent(count, locale) })
          .run(),
    }),
  ),
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
  {
    titleKey: 'editor.slash.accordion.title',
    descKey: 'editor.slash.accordion.desc',
    icon: ListCollapse,
    glyph: '▾',
    keywords: ['accordion', 'collapse', 'expand', 'faq', 'toggle'],
    command: ({ editor, range, locale }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: 'mdxAccordionGroup',
          content: [
            { type: 'mdxAccordion', attrs: { title: scaffoldText('editor.slash.default.firstSection', locale) }, content: [{ type: 'paragraph' }] },
            { type: 'mdxAccordion', attrs: { title: scaffoldText('editor.slash.default.secondSection', locale) }, content: [{ type: 'paragraph' }] },
          ],
        })
        .run(),
  },
  {
    titleKey: 'editor.slash.frame.title',
    descKey: 'editor.slash.frame.desc',
    icon: FrameIcon,
    glyph: '▣',
    keywords: ['frame', 'figure', 'screenshot', 'caption'],
    command: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: 'mdxFrame', attrs: { caption: '' }, content: [{ type: 'paragraph' }] })
        .run(),
  },
  {
    titleKey: 'editor.slash.expandable.title',
    descKey: 'editor.slash.expandable.desc',
    icon: ListCollapse,
    glyph: '⊕',
    keywords: ['expandable', 'collapse', 'disclosure', 'details'],
    command: ({ editor, range, locale }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: 'mdxExpandable',
          attrs: { title: scaffoldText('editor.slash.default.showDetails', locale) },
          content: [{ type: 'paragraph' }],
        })
        .run(),
  },
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
  {
    titleKey: 'editor.slash.icon.title',
    descKey: 'editor.slash.icon.desc',
    icon: Sparkles,
    glyph: '✦',
    keywords: ['icon', 'glyph', 'symbol', 'inline'],
    // A self-closing inline Icon atom.
    command: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: 'mdxIcon', attrs: { icon: 'star' } })
        .run(),
  },
  {
    titleKey: 'editor.slash.update.title',
    descKey: 'editor.slash.update.desc',
    icon: ListChecks,
    glyph: '✚',
    keywords: ['update', 'changelog', 'release', 'version'],
    command: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: 'mdxUpdate', attrs: { label: 'v1.0.0' }, content: [{ type: 'paragraph' }] })
        .run(),
  },
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
  {
    titleKey: 'editor.slash.codeGroup.title',
    descKey: 'editor.slash.codeGroup.desc',
    icon: Code2,
    glyph: '❐',
    keywords: ['code', 'group', 'tabs', 'languages'],
    command: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: 'mdxCodeGroup', content: [{ type: 'codeBlock', attrs: { language: 'bash' } }] })
        .run(),
  },
  {
    titleKey: 'editor.slash.fileTree.title',
    descKey: 'editor.slash.fileTree.desc',
    icon: FolderTree,
    glyph: '⌘',
    keywords: ['file', 'folder', 'tree', 'structure'],
    command: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: 'mdxFileTree',
          content: [{ type: 'mdxFile', attrs: { name: '', icon: '' } }],
        })
        .run(),
  },
  {
    titleKey: 'editor.slash.folder.title',
    descKey: 'editor.slash.folder.desc',
    icon: Folder,
    glyph: '▸',
    keywords: ['folder', 'directory', 'tree'],
    command: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: 'mdxFolder', attrs: { name: '' }, content: [{ type: 'paragraph' }] })
        .run(),
  },
  {
    titleKey: 'editor.slash.file.title',
    descKey: 'editor.slash.file.desc',
    icon: FileText,
    glyph: '⌑',
    keywords: ['file', 'document', 'tree'],
    command: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: 'mdxFile', attrs: { name: '', icon: '' } })
        .run(),
  },
  {
    titleKey: 'editor.slash.apiExample.title',
    descKey: 'editor.slash.apiExample.desc',
    icon: Braces,
    glyph: '{}',
    keywords: ['api', 'request', 'response', 'example'],
    command: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: 'mdxApiExample',
          attrs: { title: '' },
          content: [
            { type: 'mdxRequestExample', attrs: { title: '' }, content: [{ type: 'paragraph' }] },
            { type: 'mdxResponseExample', attrs: { title: '', status: '' }, content: [{ type: 'paragraph' }] },
          ],
        })
        .run(),
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
  {
    titleKey: 'editor.slash.relatedContent.title',
    descKey: 'editor.slash.relatedContent.desc',
    icon: BookOpen,
    glyph: '↗',
    keywords: ['related', 'content', 'navigation', 'resources'],
    command: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: 'mdxRelatedContent',
          attrs: { title: '' },
          content: [
            {
              type: 'mdxRelatedCard',
              attrs: { title: '', description: '', href: '', icon: '' },
              content: [{ type: 'paragraph' }],
            },
          ],
        })
        .run(),
  },
  {
    titleKey: 'editor.slash.relatedCard.title',
    descKey: 'editor.slash.relatedCard.desc',
    icon: BookOpen,
    glyph: '◇',
    keywords: ['related', 'card', 'link', 'resource'],
    command: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: 'mdxRelatedCard',
          attrs: { title: '', description: '', href: '', icon: '' },
          content: [{ type: 'paragraph' }],
        })
        .run(),
  },
  {
    titleKey: 'editor.slash.columns2.title',
    descKey: 'editor.slash.columns2.desc',
    icon: Columns3,
    glyph: '▥',
    keywords: ['columns', 'layout', 'grid'],
    command: ({ editor, range, locale }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: 'mdxColumns',
          content: columnContent(2, locale),
        })
        .run(),
  },
  ...([3, 4] as const).map(
    (count): SlashItem => ({
      titleKey: count === 3 ? 'editor.slash.columns3.title' : 'editor.slash.columns4.title',
      descKey: count === 3 ? 'editor.slash.columns3.desc' : 'editor.slash.columns4.desc',
      icon: Columns3,
      glyph: `▥${count}`,
      keywords: ['columns', 'layout', 'grid'],
      command: ({ editor, range, locale }) =>
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertContent({ type: 'mdxColumns', content: columnContent(count, locale) })
          .run(),
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
  {
    titleKey: 'editor.slash.divider.title',
    descKey: 'editor.slash.divider.desc',
    icon: Minus,
    glyph: '—',
    keywords: ['hr', 'separator', 'rule'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
  {
    titleKey: 'editor.slash.image.title',
    descKey: 'editor.slash.image.desc',
    icon: ImageIcon,
    glyph: '🖼',
    keywords: ['picture', 'photo', 'img', 'upload'],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run();
      insertImage(editor, onUpload);
    },
  },
  {
    titleKey: 'editor.slash.table.title',
    descKey: 'editor.slash.table.desc',
    icon: TableIcon,
    glyph: '⊞',
    keywords: ['grid', 'rows', 'columns'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
];

/** Resolve a slash label in one canonical catalog for locale-independent search. */
const labelInFn = (label: MessageKey, locale: 'en' | 'ar'): string => translateFn(label, undefined, locale);

/** Search haystack across BOTH locales (+ keywords) so filtering works whatever
 *  language the menu is displayed in. */
const haystackOf = (item: SlashItem): string =>
  [
    labelInFn(item.titleKey, 'en'),
    labelInFn(item.titleKey, 'ar'),
    labelInFn(item.descKey, 'en'),
    labelInFn(item.descKey, 'ar'),
    ...(item.keywords ?? []),
  ]
    .join(' ')
    .toLowerCase();

interface SlashListHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

interface SlashListProps {
  items: SlashItem[];
  command: (item: SlashItem) => void;
  ref?: Ref<SlashListHandle>;
}

export const nextSlashSelection = (selected: number, count: number, key: string): number | null => {
  if (count <= 0) return null;
  if (key === 'ArrowUp') return (selected + count - 1) % count;
  if (key === 'ArrowDown') return (selected + 1) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
};

/** Whether `/` should be captured as a command trigger at the cursor. */
export const shouldHandleSlashTrigger = (previousCharacter: string): boolean => previousCharacter === '' || previousCharacter === ' ';

/** Offset of the slash that owns the active command query, relative to the
 * current text block, or null when the cursor is not in a command query. */
export const slashTriggerOffset = (textBeforeCursor: string): number | null => {
  if (!/(?:^| )\/[^/\s]*$/.test(textBeforeCursor)) return null;
  return textBeforeCursor.lastIndexOf('/');
};

interface SlashAnchorRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Resolve the first visible popup anchor. The suggestion decoration may not
 * have committed on the slash transaction, while coordsAtPos is already valid. */
export const resolveSlashAnchor = (
  decorationRect: (() => SlashAnchorRect | null | undefined) | null | undefined,
  coordsAtPos: (position: number) => SlashAnchorRect,
  position: number,
): SlashAnchorRect | null => {
  const decorated = decorationRect?.();
  if (decorated) return decorated;
  try {
    return coordsAtPos(position);
  } catch {
    return null;
  }
};

const SlashList = ({ items, command, ref }: SlashListProps) => {
  const { t } = useLocale();
  const label = (value: MessageKey): string => t(value);
  const [selected, setSelected] = useState(0);
  const listboxId = useId();
  const containerRef = useRef<HTMLDivElement>(null);

  // Reset the highlight to the first item whenever the filtered list changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional reset-on-items-change
  useEffect(() => {
    setSelected(0);
  }, [items]);

  // Keep the active item scrolled into view.
  useLayoutEffect(() => {
    const node = containerRef.current?.querySelector<HTMLElement>(`[data-index="${selected}"]`);
    node?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  useImperativeHandle(ref, () => ({
    onKeyDown: (event) => {
      if (items.length === 0) {
        return false;
      }
      const nextSelection = nextSlashSelection(selected, items.length, event.key);
      if (nextSelection !== null) {
        setSelected(nextSelection);
        return true;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const item = items[selected];
        if (item) {
          command(item);
        }
        return true;
      }
      return false;
    },
  }));

  return (
    <div
      ref={containerRef}
      role="listbox"
      aria-label={t('editor.slash.basicBlocks')}
      className="z-50 max-h-80 w-[304px] overflow-y-auto rounded-xl border border-border bg-card p-1.5 shadow-xl"
    >
      <div className="px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground uppercase tracking-wide">{t('editor.slash.basicBlocks')}</div>
      {items.length === 0 ? (
        <div className="px-3 py-3 text-muted-foreground text-sm">{t('editor.slash.empty')}</div>
      ) : (
        items.map((item, index) => {
          const Icon = item.icon;
          return (
            <button
              type="button"
              key={labelInFn(item.titleKey, 'en')}
              id={`${listboxId}-opt-${index}`}
              role="option"
              aria-selected={index === selected}
              data-index={index}
              onMouseEnter={() => setSelected(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => command(item)}
              className={cn(
                'flex w-full cursor-pointer items-center gap-3 rounded-lg px-2.5 py-1.5 text-start',
                index === selected ? 'bg-primary/10' : 'bg-transparent',
              )}
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-card font-mono text-[13px]">
                <Icon className="size-4 text-foreground/80" />
              </span>
              <span className="min-w-0">
                <span className="block font-medium text-[13.5px] text-foreground">{label(item.titleKey)}</span>
                <span className="block truncate text-muted-foreground text-xs">{label(item.descKey)}</span>
              </span>
            </button>
          );
        })
      )}
    </div>
  );
};

const createSuggestion = (onUpload?: UploadFn, locale?: Locale): Omit<SuggestionOptions<SlashItem>, 'editor'> => {
  const items = createSlashItems(onUpload);
  return {
    pluginKey: slashSuggestionKey,
    char: '/',
    startOfLine: false,
    initialItems: items,
    items: ({ query }) => {
      const q = query.toLowerCase().trim();
      if (!q) {
        return items;
      }
      return items.filter((item) => haystackOf(item).includes(q));
    },
    command: ({ editor, range, props }) => {
      props.command({ editor, range, locale: slashPageLocale(editor, locale) });
    },
    render: () => {
      let component: ReactRenderer<SlashListHandle, SlashListProps> | null = null;
      let currentProps: SuggestionProps<SlashItem> | null = null;
      let cleanup: (() => void) | null = null;
      let positionFrame: number | null = null;

      const position = () => {
        if (!component || !currentProps) return;
        // The decoration is created by the same transaction as the slash. On
        // that first transaction it can be active before its DOM node exists,
        // so fall back to the immediately available document position.
        const anchor = resolveSlashAnchor(
          currentProps.clientRect,
          currentProps.editor.view.coordsAtPos.bind(currentProps.editor.view),
          currentProps.range.from,
        );
        if (!anchor) return;

        const popup = component.element;
        const gap = 6;
        const edge = 12;
        const popupRect = popup.getBoundingClientRect();
        const left = Math.max(edge, Math.min(anchor.left, window.innerWidth - popupRect.width - edge));
        const below = anchor.bottom + gap;
        const top = below + popupRect.height <= window.innerHeight - edge ? below : Math.max(edge, anchor.top - popupRect.height - gap);

        Object.assign(popup.style, {
          position: 'fixed',
          left: `${left}px`,
          top: `${top}px`,
          width: 'max-content',
          zIndex: '50',
        });
      };

      return {
        onStart: (props) => {
          currentProps = props;
          component = new ReactRenderer(SlashList, {
            editor: props.editor,
            props: {
              items: props.items,
              command: (item: SlashItem) => props.command(item),
            },
          });
          document.body.appendChild(component.element);
          position();
          // On the insertion transaction the suggestion decoration may not be
          // in the DOM yet, so clientRect() can legitimately be null. Position
          // again after ProseMirror commits the decoration; otherwise the menu
          // exists at the end of <body> and only appears after a later cursor
          // movement (leaving the line and coming back).
          positionFrame = requestAnimationFrame(position);

          const reposition = () => position();
          const dismiss = (event: PointerEvent) => {
            const target = event.target;
            if (target instanceof Node && component && !component.element.contains(target) && !props.editor.view.dom.contains(target)) {
              exitSuggestion(props.editor.view, slashSuggestionKey);
            }
          };
          window.addEventListener('resize', reposition);
          window.addEventListener('scroll', reposition, true);
          document.addEventListener('pointerdown', dismiss, true);
          cleanup = () => {
            if (positionFrame !== null) cancelAnimationFrame(positionFrame);
            positionFrame = null;
            window.removeEventListener('resize', reposition);
            window.removeEventListener('scroll', reposition, true);
            document.removeEventListener('pointerdown', dismiss, true);
            component?.element.remove();
          };
        },
        onUpdate: (props) => {
          currentProps = props;
          component?.updateProps({
            items: props.items,
            command: (item: SlashItem) => props.command(item),
          });
          if (positionFrame !== null) cancelAnimationFrame(positionFrame);
          positionFrame = requestAnimationFrame(position);
        },
        onKeyDown: (props) => {
          if (props.event.key === 'Escape') {
            return true;
          }
          return component?.ref?.onKeyDown(props.event) ?? false;
        },
        onExit: () => {
          cleanup?.();
          cleanup = null;
          component?.destroy();
          component = null;
          currentProps = null;
        },
      };
    },
  };
};

const slashSuggestionKey = new PluginKey('nibleaf-slash-command');

/** Slash-command extension: type `/` to open the Basic blocks menu. `locale` is
 *  the page language for inserted scaffold text; when omitted it is derived from
 *  the host's `dir` wrapper (see `slashPageLocale`). */
export const SlashCommand = Extension.create<{ onUpload?: UploadFn; locale?: Locale }>({
  name: 'slashCommand',
  addOptions() {
    return { onUpload: undefined, locale: undefined };
  },
  addProseMirrorPlugins() {
    return [Suggestion({ editor: this.editor, ...createSuggestion(this.options.onUpload, this.options.locale) })];
  },
});
