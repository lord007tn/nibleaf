import { cn } from '@nibleaf/design-system/lib/utils';
import type { Editor, Range } from '@tiptap/core';
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { ReactRenderer } from '@tiptap/react';
import Suggestion, { exitSuggestion, type SuggestionOptions, type SuggestionProps } from '@tiptap/suggestion';
import {
  AppWindow,
  Badge as BadgeIcon,
  Code2,
  Columns3,
  Frame as FrameIcon,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  LayoutGrid,
  Lightbulb,
  List,
  ListChecks,
  ListCollapse,
  ListOrdered,
  ListTodo,
  MessageCircle,
  Minus,
  PanelTop,
  Quote,
  Sparkles,
  Table as TableIcon,
  Type,
  Workflow,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { forwardRef, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { useLocale } from '@/lib/i18n';
import { type MessageKey, messages } from '@/lib/i18n/messages';

/** An inline en+ar label pair, for slash items whose strings are not (yet) in
 *  the shared messages catalog. Resolved the same way as a `MessageKey`. */
interface InlineLabel {
  en: string;
  ar: string;
}

/** A slash-item label: either a shared i18n key or an inline en/ar pair. */
type SlashLabel = MessageKey | InlineLabel;

const isMessageKey = (label: SlashLabel): label is MessageKey => typeof label === 'string';

interface SlashItem {
  titleKey: SlashLabel;
  descKey: SlashLabel;
  icon: ComponentType<{ className?: string }>;
  /** Short mono glyph shown in the 32px tile (matches the design's monospace tiles). */
  glyph: string;
  keywords?: string[];
  command: (props: { editor: Editor; range: Range }) => void;
}

/** Uploads a picked image and returns its hosted URL (or null on failure). */
type UploadFn = (file: File) => Promise<string | null>;

/** Open a native file picker, upload the chosen image, and insert it. Falls back
 *  to a URL prompt when no uploader is wired. */
function insertImage(editor: Editor, onUpload?: UploadFn) {
  if (!onUpload) {
    const url = window.prompt('Image URL');
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

const createItems = (onUpload?: UploadFn): SlashItem[] => [
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
    titleKey: 'editor.slash.callout.title',
    descKey: 'editor.slash.callout.desc',
    icon: Lightbulb,
    glyph: '!',
    keywords: ['note', 'admonition', 'warning', 'info'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setCallout({ variant: 'note' }).run(),
  },
  {
    titleKey: 'editor.slash.steps.title',
    descKey: 'editor.slash.steps.desc',
    icon: ListChecks,
    glyph: '№',
    keywords: ['steps', 'guide', 'procedure', 'tutorial', 'how-to'],
    command: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: 'mdxSteps',
          content: [
            { type: 'mdxStep', attrs: { title: 'First step' }, content: [{ type: 'paragraph' }] },
            { type: 'mdxStep', attrs: { title: 'Second step' }, content: [{ type: 'paragraph' }] },
          ],
        })
        .run(),
  },
  {
    titleKey: 'editor.slash.cardGroup.title',
    descKey: 'editor.slash.cardGroup.desc',
    icon: LayoutGrid,
    glyph: '▦',
    keywords: ['card', 'cards', 'grid', 'tiles'],
    command: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: 'mdxCardGroup',
          attrs: { cols: '2' },
          content: [
            { type: 'mdxCard', attrs: { title: 'First card' }, content: [{ type: 'paragraph' }] },
            { type: 'mdxCard', attrs: { title: 'Second card' }, content: [{ type: 'paragraph' }] },
          ],
        })
        .run(),
  },
  {
    titleKey: 'editor.slash.tabs.title',
    descKey: 'editor.slash.tabs.desc',
    icon: AppWindow,
    glyph: '⊟',
    keywords: ['tab', 'tabs', 'panes'],
    command: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: 'mdxTabs',
          content: [
            { type: 'mdxTab', attrs: { title: 'First tab' }, content: [{ type: 'paragraph' }] },
            { type: 'mdxTab', attrs: { title: 'Second tab' }, content: [{ type: 'paragraph' }] },
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
    command: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: 'mdxAccordionGroup',
          content: [
            { type: 'mdxAccordion', attrs: { title: 'First section' }, content: [{ type: 'paragraph' }] },
            { type: 'mdxAccordion', attrs: { title: 'Second section' }, content: [{ type: 'paragraph' }] },
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
    command: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: 'mdxExpandable', attrs: { title: 'Show details' }, content: [{ type: 'paragraph' }] })
        .run(),
  },
  {
    titleKey: { en: 'Tooltip', ar: 'تلميح' },
    descKey: { en: 'Inline text with a hover tooltip.', ar: 'نص مضمّن مع تلميح عند التمرير.' },
    icon: MessageCircle,
    glyph: '?',
    keywords: ['tooltip', 'hint', 'hover', 'inline'],
    // An inline Tooltip wrapping the current selection (or placeholder text).
    command: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: 'mdxTooltip', attrs: { tip: 'Tooltip text' }, content: [{ type: 'text', text: 'term' }] })
        .run(),
  },
  {
    titleKey: { en: 'Icon', ar: 'أيقونة' },
    descKey: { en: 'An inline icon by name.', ar: 'أيقونة مضمّنة بالاسم.' },
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
    titleKey: { en: 'Columns', ar: 'أعمدة' },
    descKey: { en: 'A responsive two-column layout.', ar: 'تخطيط متجاوب من عمودين.' },
    icon: Columns3,
    glyph: '▥',
    keywords: ['columns', 'layout', 'grid'],
    command: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: 'mdxColumns',
          content: [
            { type: 'mdxColumn', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First column' }] }] },
            { type: 'mdxColumn', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Second column' }] }] },
          ],
        })
        .run(),
  },
  {
    titleKey: { en: 'Banner', ar: 'شريط إعلان' },
    descKey: { en: 'A prominent announcement block.', ar: 'كتلة إعلان بارزة.' },
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
    titleKey: { en: 'Badge', ar: 'شارة' },
    descKey: { en: 'A compact inline status label.', ar: 'تسمية حالة مضمّنة.' },
    icon: BadgeIcon,
    glyph: '●',
    keywords: ['badge', 'label', 'status'],
    command: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: 'mdxBadge', content: [{ type: 'text', text: 'New' }] })
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

/** Resolve a slash label in one locale (message key or inline pair). */
const labelIn = (label: SlashLabel, locale: 'en' | 'ar'): string => (isMessageKey(label) ? messages[locale][label] : label[locale]);

/** Search haystack across BOTH locales (+ keywords) so filtering works whatever
 *  language the menu is displayed in. */
const haystackOf = (item: SlashItem): string =>
  [labelIn(item.titleKey, 'en'), labelIn(item.titleKey, 'ar'), labelIn(item.descKey, 'en'), labelIn(item.descKey, 'ar'), ...(item.keywords ?? [])]
    .join(' ')
    .toLowerCase();

interface SlashListHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

interface SlashListProps {
  items: SlashItem[];
  command: (item: SlashItem) => void;
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

/** Pick the cursor position that should own a post-commit slash refresh. The
 * current cursor wins when the user already continued typing a query; otherwise
 * restore the cursor just after the slash if a controlled Markdown round-trip
 * replaced the document during the same paint. */
export const slashRefreshTarget = (
  textBeforeCursor: string,
  cursorPosition: number,
  insertedPosition: number,
  slashStillPresent: boolean,
): number | null => {
  if (slashTriggerOffset(textBeforeCursor) !== null) return cursorPosition;
  return slashStillPresent ? insertedPosition + 1 : null;
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

const SlashList = forwardRef<SlashListHandle, SlashListProps>(({ items, command }, ref) => {
  const { t, locale } = useLocale();
  /** Resolve a slash label in the active locale (shared key or inline pair). */
  const label = (value: SlashLabel): string => (isMessageKey(value) ? t(value) : labelIn(value, locale));
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
              key={labelIn(item.titleKey, 'en')}
              id={`${listboxId}-opt-${index}`}
              role="option"
              aria-selected={index === selected}
              data-index={index}
              onMouseEnter={() => setSelected(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => command(item)}
              className={cn(
                'flex w-full cursor-pointer items-center gap-3 rounded-lg px-2.5 py-1.5 text-start',
                index === selected ? 'bg-muted' : 'bg-transparent',
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
});
SlashList.displayName = 'SlashList';

const createSuggestion = (onUpload?: UploadFn): Omit<SuggestionOptions<SlashItem>, 'editor'> => {
  const items = createItems(onUpload);
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
      props.command({ editor, range });
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
const slashInputRefreshKey = new PluginKey('nibleaf-slash-input-refresh');

/** Re-evaluate the suggestion after the slash has committed to the DOM. The
 * editor is controlled by Markdown, so its first input can be normalized and
 * re-seeded in the same paint. That transaction closes Tiptap's Suggestion even
 * though the slash remains; a selection transaction after commit opens it at
 * the first keystroke instead of waiting for the user to move the cursor. */
const createSlashInputRefresh = () => {
  let frame: number | null = null;
  return new Plugin({
    key: slashInputRefreshKey,
    props: {
      handleTextInput: (view, from, _to, text) => {
        if (text !== '/') return false;
        const $from = view.state.doc.resolve(from);
        const previousCharacter = $from.parentOffset === 0 ? '' : $from.parent.textBetween($from.parentOffset - 1, $from.parentOffset, '', '');
        if (!shouldHandleSlashTrigger(previousCharacter)) return false;

        if (frame !== null) cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          frame = null;
          if (view.isDestroyed || (slashSuggestionKey.getState(view.state) as { active?: boolean } | undefined)?.active) return;

          const { selection, doc } = view.state;
          const $cursor = selection.$from;
          const textBeforeCursor = $cursor.parent.textBetween(0, $cursor.parentOffset, '', '');
          const slashStillPresent = from < doc.content.size && doc.textBetween(from, from + 1, '', '') === '/';
          const target = slashRefreshTarget(textBeforeCursor, selection.from, from, slashStillPresent);
          if (target === null || target > doc.content.size) return;

          const nextSelection = target === selection.from ? selection : TextSelection.near(doc.resolve(target), 1);
          view.dispatch(view.state.tr.setSelection(nextSelection).setMeta(slashInputRefreshKey, true));
        });
        return false;
      },
    },
    view: () => ({
      destroy: () => {
        if (frame !== null) cancelAnimationFrame(frame);
      },
    }),
  });
};

/** Slash-command extension: type `/` to open the Basic blocks menu. */
export const SlashCommand = Extension.create<{ onUpload?: UploadFn }>({
  name: 'slashCommand',
  addOptions() {
    return { onUpload: undefined };
  },
  addProseMirrorPlugins() {
    return [createSlashInputRefresh(), Suggestion({ editor: this.editor, ...createSuggestion(this.options.onUpload) })];
  },
});

export default SlashCommand;
