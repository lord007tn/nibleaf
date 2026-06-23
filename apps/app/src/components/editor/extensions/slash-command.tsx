import type { Editor, Range } from '@tiptap/core';
import { Extension } from '@tiptap/core';
import { ReactRenderer } from '@tiptap/react';
import Suggestion, { type SuggestionOptions } from '@tiptap/suggestion';
import {
  AppWindow,
  Code2,
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
  Minus,
  Quote,
  Table as TableIcon,
  Type,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n';
import { type MessageKey, messages } from '@/lib/i18n/messages';
import { cn } from '@/lib/utils';

interface SlashItem {
  titleKey: MessageKey;
  descKey: MessageKey;
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

/** Search haystack across BOTH locales (+ keywords) so filtering works whatever
 *  language the menu is displayed in. */
const haystackOf = (item: SlashItem): string =>
  [messages.en[item.titleKey], messages.ar[item.titleKey], messages.en[item.descKey], messages.ar[item.descKey], ...(item.keywords ?? [])]
    .join(' ')
    .toLowerCase();

interface SlashListHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

interface SlashListProps {
  items: SlashItem[];
  command: (item: SlashItem) => void;
}

const SlashList = forwardRef<SlashListHandle, SlashListProps>(({ items, command }, ref) => {
  const t = useT();
  const [selected, setSelected] = useState(0);
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
      if (event.key === 'ArrowUp') {
        setSelected((i) => (i + items.length - 1) % items.length);
        return true;
      }
      if (event.key === 'ArrowDown') {
        setSelected((i) => (i + 1) % items.length);
        return true;
      }
      if (event.key === 'Enter') {
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
    <div ref={containerRef} className="z-50 max-h-80 w-[304px] overflow-y-auto rounded-xl border border-border bg-card p-1.5 shadow-xl">
      <div className="px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground uppercase tracking-wide">{t('editor.slash.basicBlocks')}</div>
      {items.length === 0 ? (
        <div className="px-3 py-3 text-muted-foreground text-sm">{t('editor.slash.empty')}</div>
      ) : (
        items.map((item, index) => {
          const Icon = item.icon;
          return (
            <button
              type="button"
              key={item.titleKey}
              data-index={index}
              onMouseEnter={() => setSelected(index)}
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
                <span className="block font-medium text-[13.5px] text-foreground">{t(item.titleKey)}</span>
                <span className="block truncate text-muted-foreground text-xs">{t(item.descKey)}</span>
              </span>
            </button>
          );
        })
      )}
    </div>
  );
});
SlashList.displayName = 'SlashList';

/** Position a floating element at the current caret/selection rect. */
function positionPopup(el: HTMLElement, rect: DOMRect | null | undefined) {
  if (!rect) {
    return;
  }
  el.style.position = 'absolute';
  el.style.top = `${window.scrollY + rect.bottom + 6}px`;
  el.style.left = `${window.scrollX + rect.left}px`;
}

const createSuggestion = (onUpload?: UploadFn): Omit<SuggestionOptions<SlashItem>, 'editor'> => {
  const items = createItems(onUpload);
  return {
    char: '/',
    startOfLine: false,
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
      let wrapper: HTMLDivElement | null = null;

      return {
        onStart: (props) => {
          component = new ReactRenderer(SlashList, {
            editor: props.editor,
            props: {
              items: props.items,
              command: (item: SlashItem) => props.command(item),
            },
          });
          wrapper = document.createElement('div');
          wrapper.style.position = 'absolute';
          wrapper.style.zIndex = '50';
          wrapper.appendChild(component.element);
          document.body.appendChild(wrapper);
          positionPopup(wrapper, props.clientRect?.());
        },
        onUpdate: (props) => {
          component?.updateProps({
            items: props.items,
            command: (item: SlashItem) => props.command(item),
          });
          if (wrapper) {
            positionPopup(wrapper, props.clientRect?.());
          }
        },
        onKeyDown: (props) => {
          if (props.event.key === 'Escape') {
            wrapper?.remove();
            wrapper = null;
            return true;
          }
          return component?.ref?.onKeyDown(props.event) ?? false;
        },
        onExit: () => {
          wrapper?.remove();
          wrapper = null;
          component?.destroy();
          component = null;
        },
      };
    },
  };
};

/** Slash-command extension: type `/` to open the Basic blocks menu. */
export const SlashCommand = Extension.create<{ onUpload?: UploadFn }>({
  name: 'slashCommand',
  addOptions() {
    return { onUpload: undefined };
  },
  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...createSuggestion(this.options.onUpload),
      }),
    ];
  },
});

export default SlashCommand;
