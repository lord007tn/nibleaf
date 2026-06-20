import type { Editor } from '@tiptap/core';
import CharacterCount from '@tiptap/extension-character-count';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
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
import { useEffect, useRef } from 'react';
import { Markdown } from 'tiptap-markdown';
import { cn } from '@/lib/utils';
import { EditorBubbleMenu } from './editor-bubble-menu';
import { Callout } from './extensions/callout';
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
    return [
      'pre',
      { ...HTMLAttributes, 'data-language': language ?? 'code' },
      ['code', { class: language ? `language-${language}` : undefined }, 0],
    ];
  },
});

interface TiptapEditorProps {
  /** Markdown source — the single source of truth. */
  value: string;
  /** Called with updated Markdown on every editor change. */
  onChange: (markdown: string) => void;
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
export function TiptapEditor({ value, onChange, dir = 'ltr', editable = true, className }: TiptapEditorProps) {
  const lastEmitted = useRef<string>(value);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const editor = useEditor({
    editable,
    extensions: [
      StarterKit.configure({
        // CodeBlockLowlight replaces StarterKit's plain code block.
        codeBlock: false,
        link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } },
      }),
      Markdown.configure({ html: false, transformCopiedText: true, transformPastedText: true }),
      Placeholder.configure({
        placeholder: ({ node }) =>
          node.type.name === 'heading' ? 'Heading' : "Write something, or press '/' for commands",
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
      SlashCommand,
    ],
    content: value,
    onCreate: ({ editor }) => {
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
      <EditorContent editor={editor} />
    </div>
  );
}

export default TiptapEditor;
