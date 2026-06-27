import type { Editor } from '@tiptap/core';
import CharacterCount from '@tiptap/extension-character-count';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { DragHandle } from '@tiptap/extension-drag-handle-react';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { Table } from '@tiptap/extension-table';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TableRow from '@tiptap/extension-table-row';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { common, createLowlight } from 'lowlight';
import { GripVertical, Plus } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Markdown } from 'tiptap-markdown';
import { cn } from '@/lib/utils';
import { EditorBubbleMenu } from './editor-bubble-menu';
import { Callout } from './extensions/callout';
import { mdxNodes } from './extensions/mdx-nodes';
import { SlashCommand } from './extensions/slash-command';
import './tiptap.css';

// Register a small set of common languages for code-block highlighting.
const lowlight = createLowlight(common);

/** Typed accessor for the tiptap-markdown storage (not part of the core Storage type). */
function getMarkdown(editor: Editor): string {
  const storage = editor.storage as { markdown?: { getMarkdown(): string } };
  return storage.markdown?.getMarkdown() ?? '';
}

/** CodeBlockLowlight that mirrors the chosen language onto the <pre> as `data-language`,
 * so the dark chrome's label bar (CSS ::before) can display it. */
const CodeBlock = CodeBlockLowlight.extend({
  renderHTML({ node, HTMLAttributes }) {
    const language = node.attrs.language || null;
    return ['pre', { ...HTMLAttributes, 'data-language': language ?? 'code' }, ['code', { class: language ? `language-${language}` : undefined }, 0]];
  },
});

/** Notion-style block handle: a grip to drag-reorder blocks and a + to insert a
 *  new block. Floats in the start-side gutter (left in LTR, right in RTL) of
 *  whichever block the cursor hovers. */
function BlockHandle({ editor, dir }: { editor: Editor; dir: 'ltr' | 'rtl' }) {
  const posRef = useRef<number | null>(null);
  const insertBelow = () => {
    const pos = posRef.current;
    if (pos === null) {
      return;
    }
    const node = editor.state.doc.nodeAt(pos);
    const end = node ? pos + node.nodeSize : editor.state.doc.content.size;
    // Insert an empty block and a '/' to pop the slash menu, Notion-style.
    editor
      .chain()
      .focus()
      .insertContentAt(end, { type: 'paragraph', content: [{ type: 'text', text: '/' }] })
      .run();
  };
  return (
    <DragHandle
      editor={editor}
      computePositionConfig={{ placement: dir === 'rtl' ? 'right-start' : 'left-start' }}
      onNodeChange={({ pos }) => {
        posRef.current = pos;
      }}
    >
      <div className="flex items-center gap-0.5 px-1 text-muted-foreground">
        <button
          type="button"
          title="Insert block"
          onMouseDown={(event) => event.preventDefault()}
          onClick={insertBelow}
          className="grid size-6 cursor-pointer place-items-center rounded hover:bg-muted hover:text-foreground"
        >
          <Plus className="size-4" />
        </button>
        <span
          title="Drag to move"
          className="grid size-6 cursor-grab place-items-center rounded hover:bg-muted hover:text-foreground active:cursor-grabbing"
        >
          <GripVertical className="size-4" />
        </span>
      </div>
    </DragHandle>
  );
}

interface TiptapEditorProps {
  /** Markdown source — the single source of truth. */
  value: string;
  /** Called with updated Markdown on every editor change. */
  onChange: (markdown: string) => void;
  /** Upload a pasted/dropped/picked image, returning its hosted URL (or null). */
  onUpload?: (file: File) => Promise<string | null>;
  dir?: 'ltr' | 'rtl';
  editable?: boolean;
  className?: string;
}

/**
 * Markdown-controlled TipTap v3 WYSIWYG editor.
 *
 * Content is always Markdown (load-bearing for search/TOC/the live site): we seed
 * the editor via `setContent(markdown)` and emit `editor.storage.markdown.getMarkdown()`
 * on every update. We keep a ref of the last-emitted markdown so external value
 * changes (e.g. the AI assistant rewriting the doc) re-seed the editor, while the
 * user's own keystrokes don't cause a feedback loop / cursor reset.
 */
export function TiptapEditor({ value, onChange, onUpload, dir = 'ltr', editable = true, className }: TiptapEditorProps) {
  const lastEmitted = useRef<string>(value);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onUploadRef = useRef(onUpload);
  onUploadRef.current = onUpload;
  const editorRef = useRef<Editor | null>(null);

  // Upload an image file and insert it at the current selection.
  const insertUploadedImage = (file: File) => {
    const upload = onUploadRef.current;
    const ed = editorRef.current;
    if (!upload || !ed || !file.type.startsWith('image/')) {
      return;
    }
    upload(file)
      .then((url) => {
        if (url) {
          ed.chain().focus().setImage({ src: url }).run();
        }
      })
      .catch(() => undefined);
  };

  const editor = useEditor({
    editable,
    extensions: [
      StarterKit.configure({
        // CodeBlockLowlight replaces StarterKit's plain code block.
        codeBlock: false,
        link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } },
      }),
      // html:true so raw MDX component tags (<Steps>, <Step>, …) survive the
      // Markdown round-trip and our custom nodes can rebuild them on parse.
      Markdown.configure({ html: true, transformCopiedText: true, transformPastedText: true }),
      Placeholder.configure({
        placeholder: ({ node }) => (node.type.name === 'heading' ? 'Heading' : "Write something, or press '/' for commands"),
      }),
      CodeBlock.configure({ lowlight }),
      Highlight.configure({ multicolor: false }),
      Image.configure({ inline: false, allowBase64: true }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      CharacterCount,
      Callout,
      ...mdxNodes,
      SlashCommand.configure({ onUpload: (file: File) => onUploadRef.current?.(file) ?? Promise.resolve(null) }),
    ],
    content: value,
    onCreate: ({ editor }) => {
      editorRef.current = editor;
      // Seed once with the markdown source (StarterKit treats string content as HTML;
      // tiptap-markdown's setContent parses markdown).
      editor.commands.setContent(value);
      lastEmitted.current = getMarkdown(editor);
    },
    onUpdate: ({ editor }) => {
      const markdown = getMarkdown(editor);
      lastEmitted.current = markdown;
      onChangeRef.current(markdown);
    },
    editorProps: {
      attributes: {
        class: 'focus:outline-none',
      },
      // Paste or drop an image file → upload and insert the hosted URL.
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
        if (files.length === 0 || !onUploadRef.current) {
          return false;
        }
        event.preventDefault();
        for (const file of files) {
          insertUploadedImage(file);
        }
        return true;
      },
      handleDrop: (_view, event) => {
        const files = Array.from((event as DragEvent).dataTransfer?.files ?? []).filter((f) => f.type.startsWith('image/'));
        if (files.length === 0 || !onUploadRef.current) {
          return false;
        }
        event.preventDefault();
        for (const file of files) {
          insertUploadedImage(file);
        }
        return true;
      },
    },
  });

  // Re-seed when `value` changes externally (differs from what the editor last emitted).
  useEffect(() => {
    if (!editor) {
      return;
    }
    if (value !== lastEmitted.current) {
      lastEmitted.current = value;
      // `emitUpdate: false` so re-seeding doesn't bounce back through onChange.
      editor.commands.setContent(value, { emitUpdate: false });
    }
  }, [value, editor]);

  // Keep editability in sync.
  useEffect(() => {
    editor?.setEditable(editable);
  }, [editable, editor]);

  return (
    <div className={cn('pl-editor', className)} dir={dir}>
      {editor ? <EditorBubbleMenu editor={editor} /> : null}
      {editor ? <BlockHandle editor={editor} dir={dir ?? 'ltr'} /> : null}
      <EditorContent editor={editor} />
    </div>
  );
}

export default TiptapEditor;
