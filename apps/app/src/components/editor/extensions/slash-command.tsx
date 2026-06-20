import { Extension } from '@tiptap/core';
import { ReactRenderer } from '@tiptap/react';
import Suggestion, { type SuggestionOptions } from '@tiptap/suggestion';
import type { Editor, Range } from '@tiptap/core';
import {
  Code2,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Lightbulb,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Quote,
  Table as TableIcon,
  Type,
} from 'lucide-react';
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import { cn } from '@/lib/utils';

interface SlashItem {
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  /** Short mono glyph shown in the 32px tile (matches the design's monospace tiles). */
  glyph: string;
  keywords?: string[];
  command: (props: { editor: Editor; range: Range }) => void;
}

const ITEMS: SlashItem[] = [
  {
    title: 'Text',
    description: 'Plain paragraph text.',
    icon: Type,
    glyph: '¶',
    keywords: ['paragraph', 'p'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setParagraph().run(),
  },
  {
    title: 'Heading 1',
    description: 'Large section heading.',
    icon: Heading1,
    glyph: 'H1',
    keywords: ['h1', 'title'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run(),
  },
  {
    title: 'Heading 2',
    description: 'Medium section heading.',
    icon: Heading2,
    glyph: 'H2',
    keywords: ['h2', 'subtitle'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run(),
  },
  {
    title: 'Heading 3',
    description: 'Small section heading.',
    icon: Heading3,
    glyph: 'H3',
    keywords: ['h3'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run(),
  },
  {
    title: 'Bullet list',
    description: 'A simple bulleted list.',
    icon: List,
    glyph: '•',
    keywords: ['unordered', 'ul', 'bullet'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    title: 'Numbered list',
    description: 'An ordered, numbered list.',
    icon: ListOrdered,
    glyph: '1.',
    keywords: ['ordered', 'ol', 'number'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    title: 'To-do list',
    description: 'Track tasks with checkboxes.',
    icon: ListTodo,
    glyph: '☐',
    keywords: ['task', 'todo', 'checkbox'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleTaskList().run(),
  },
  {
    title: 'Quote',
    description: 'Capture a quotation.',
    icon: Quote,
    glyph: '"',
    keywords: ['blockquote'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
  {
    title: 'Code block',
    description: 'Syntax-highlighted code.',
    icon: Code2,
    glyph: '<>',
    keywords: ['snippet', 'pre'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
  },
  {
    title: 'Callout',
    description: 'A colored note or warning.',
    icon: Lightbulb,
    glyph: '!',
    keywords: ['note', 'admonition', 'warning', 'info'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setCallout({ variant: 'note' }).run(),
  },
  {
    title: 'Divider',
    description: 'A horizontal rule.',
    icon: Minus,
    glyph: '—',
    keywords: ['hr', 'separator', 'rule'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
  {
    title: 'Image',
    description: 'Embed an image by URL.',
    icon: ImageIcon,
    glyph: '🖼',
    keywords: ['picture', 'photo', 'img'],
    command: ({ editor, range }) => {
      const url = window.prompt('Image URL');
      const chain = editor.chain().focus().deleteRange(range);
      if (url) {
        chain.setImage({ src: url }).run();
      } else {
        chain.run();
      }
    },
  },
  {
    title: 'Table',
    description: 'Insert a 3×3 table.',
    icon: TableIcon,
    glyph: '⊞',
    keywords: ['grid', 'rows', 'columns'],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
];

interface SlashListHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

interface SlashListProps {
  items: SlashItem[];
  command: (item: SlashItem) => void;
}

const SlashList = forwardRef<SlashListHandle, SlashListProps>(({ items, command }, ref) => {
  const [selected, setSelected] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

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
    <div
      ref={containerRef}
      className="z-50 max-h-80 w-[304px] overflow-y-auto rounded-xl border border-border bg-card p-1.5 shadow-xl"
    >
      <div className="px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground uppercase tracking-wide">Basic blocks</div>
      {items.length === 0 ? (
        <div className="px-3 py-3 text-muted-foreground text-sm">No blocks found</div>
      ) : (
        items.map((item, index) => {
          const Icon = item.icon;
          return (
            <button
              type="button"
              key={item.title}
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
                <span className="block font-medium text-[13.5px] text-foreground">{item.title}</span>
                <span className="block truncate text-muted-foreground text-xs">{item.description}</span>
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

const suggestion: Omit<SuggestionOptions<SlashItem>, 'editor'> = {
  char: '/',
  startOfLine: false,
  items: ({ query }) => {
    const q = query.toLowerCase().trim();
    if (!q) {
      return ITEMS;
    }
    return ITEMS.filter((item) => {
      const haystack = [item.title, item.description, ...(item.keywords ?? [])].join(' ').toLowerCase();
      return haystack.includes(q);
    });
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

/** Slash-command extension: type `/` to open the Basic blocks menu. */
export const SlashCommand = Extension.create({
  name: 'slashCommand',
  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...suggestion,
      }),
    ];
  },
});

export default SlashCommand;
