import { cn } from '@nibleaf/design-system/lib/utils';
import type { Editor } from '@tiptap/core';
import CharacterCount from '@tiptap/extension-character-count';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { DragHandle, type DragHandleProps } from '@tiptap/extension-drag-handle-react';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import { Table } from '@tiptap/extension-table';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TableRow from '@tiptap/extension-table-row';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import TextAlign from '@tiptap/extension-text-align';
import Typography from '@tiptap/extension-typography';
import Underline from '@tiptap/extension-underline';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import { common, createLowlight } from 'lowlight';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  GripVertical,
  Heading1,
  Heading2,
  Italic,
  List,
  ListOrdered,
  MessageSquarePlus,
  Plus,
  Quote,
  Redo2,
  Strikethrough,
  Underline as UnderlineIcon,
  Undo2,
} from 'lucide-react';
import { type CSSProperties, useCallback, useEffect, useMemo, useRef } from 'react';
import { Markdown } from 'tiptap-markdown';
import { useT } from '@/lib/i18n';
import { EditorBubbleMenu } from './editor-bubble-menu';
import { Callout } from './extensions/callout';
import { CommentDecorations, type CommentMarker } from './extensions/comment-decorations';
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
  const t = useT();
  const posRef = useRef<number | null>(null);
  // DragHandle registers a ProseMirror plugin and tears it down whenever these
  // callback/config identities change. Keep them stable across controlled editor
  // renders so typing cannot destroy the simultaneously-open slash plugin view.
  const computePositionConfig = useMemo(
    () => ({ placement: dir === 'rtl' ? 'right' : 'left' }) satisfies DragHandleProps['computePositionConfig'],
    [dir],
  );
  const handleNodeChange = useCallback<NonNullable<DragHandleProps['onNodeChange']>>(({ pos }) => {
    posRef.current = pos;
  }, []);
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
    <DragHandle editor={editor} computePositionConfig={computePositionConfig} onNodeChange={handleNodeChange}>
      <div className="flex items-center gap-0.5 px-1 text-muted-foreground">
        <button
          type="button"
          title={t('editor.insertBlock')}
          aria-label={t('editor.insertBlock')}
          onMouseDown={(event) => event.preventDefault()}
          onClick={insertBelow}
          className="grid size-6 cursor-pointer place-items-center rounded hover:bg-muted hover:text-foreground"
        >
          <Plus className="size-4" />
        </button>
        <span
          title={t('editor.dragToMove')}
          className="grid size-6 cursor-grab place-items-center rounded hover:bg-muted hover:text-foreground active:cursor-grabbing"
        >
          <GripVertical className="size-4" />
        </span>
      </div>
    </DragHandle>
  );
}

/** Review-mode selection action. It appears only after the reviewer highlights
 * text and preserves the precise ProseMirror range for durable anchoring. */
function CommentSelectionMenu({
  editor,
  onAddComment,
}: {
  editor: Editor;
  onAddComment: (anchor: { quote: string; from: number; to: number }) => void;
}) {
  const t = useT();
  return (
    <BubbleMenu editor={editor} shouldShow={({ editor: current }) => !current.state.selection.empty} options={{ placement: 'top' }}>
      <button
        type="button"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          const { from, to } = editor.state.selection;
          const quote = editor.state.doc.textBetween(from, to, ' ').trim();
          if (quote) onAddComment({ quote, from, to });
        }}
        className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 font-medium text-sm shadow-lg hover:bg-muted"
      >
        <MessageSquarePlus className="size-4" />
        {t('editor.comment')}
      </button>
    </BubbleMenu>
  );
}

function DocumentToolbar({ editor }: { editor: Editor }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      canUndo: current.can().undo(),
      canRedo: current.can().redo(),
      heading1: current.isActive('heading', { level: 1 }),
      heading2: current.isActive('heading', { level: 2 }),
      bold: current.isActive('bold'),
      italic: current.isActive('italic'),
      underline: current.isActive('underline'),
      strike: current.isActive('strike'),
      bulletList: current.isActive('bulletList'),
      orderedList: current.isActive('orderedList'),
      blockquote: current.isActive('blockquote'),
      alignLeft: current.isActive({ textAlign: 'left' }),
      alignCenter: current.isActive({ textAlign: 'center' }),
      alignRight: current.isActive({ textAlign: 'right' }),
    }),
  });
  const actions = [
    { label: 'Undo', icon: Undo2, active: false, run: () => editor.chain().focus().undo().run(), disabled: !state.canUndo },
    { label: 'Redo', icon: Redo2, active: false, run: () => editor.chain().focus().redo().run(), disabled: !state.canRedo },
    {
      label: 'Heading 1',
      icon: Heading1,
      active: state.heading1,
      run: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
    },
    {
      label: 'Heading 2',
      icon: Heading2,
      active: state.heading2,
      run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    { label: 'Bold', icon: Bold, active: state.bold, run: () => editor.chain().focus().toggleBold().run() },
    { label: 'Italic', icon: Italic, active: state.italic, run: () => editor.chain().focus().toggleItalic().run() },
    { label: 'Underline', icon: UnderlineIcon, active: state.underline, run: () => editor.chain().focus().toggleUnderline().run() },
    { label: 'Strikethrough', icon: Strikethrough, active: state.strike, run: () => editor.chain().focus().toggleStrike().run() },
    { label: 'Bulleted list', icon: List, active: state.bulletList, run: () => editor.chain().focus().toggleBulletList().run() },
    {
      label: 'Numbered list',
      icon: ListOrdered,
      active: state.orderedList,
      run: () => editor.chain().focus().toggleOrderedList().run(),
    },
    { label: 'Quote', icon: Quote, active: state.blockquote, run: () => editor.chain().focus().toggleBlockquote().run() },
    {
      label: 'Align left',
      icon: AlignLeft,
      active: state.alignLeft,
      run: () => editor.chain().focus().setTextAlign('left').run(),
    },
    {
      label: 'Align center',
      icon: AlignCenter,
      active: state.alignCenter,
      run: () => editor.chain().focus().setTextAlign('center').run(),
    },
    {
      label: 'Align right',
      icon: AlignRight,
      active: state.alignRight,
      run: () => editor.chain().focus().setTextAlign('right').run(),
    },
  ];
  return (
    <div className="sticky top-0 z-10 mb-5 flex min-h-11 items-center gap-0.5 overflow-x-auto rounded-xl border border-border bg-background/95 p-1.5 shadow-sm backdrop-blur">
      {actions.map(({ label, icon: Icon, active, run, disabled }, index) => (
        <button
          key={label}
          type="button"
          title={label}
          aria-label={label}
          aria-pressed={active}
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={run}
          className={cn(
            'grid size-8 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40',
            active && 'bg-muted text-foreground',
            (index === 2 || index === 4 || index === 8 || index === 11) && 'ms-1 border-border border-s ps-1',
          )}
        >
          <Icon className="size-4" />
        </button>
      ))}
    </div>
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
  /** Typography variables (typeset.css contract) so the editor mirrors the
   *  project's configured reading rhythm — see lib/typography.ts. */
  style?: CSSProperties;
  /** Comments anchored on this page — their quotes are highlighted in the body. */
  comments?: CommentMarker[];
  /** The focused comment id (drawn stronger). */
  activeCommentId?: string | null;
  /** Comment mode: clicking a block anchors a new comment to it (review mode). */
  commentMode?: boolean;
  /** Called when a block is clicked in comment mode, with the anchor to attach. */
  onAddComment?: (anchor: { quote: string; from: number; to: number }) => void;
  /** Notion-like block controls or a persistent document toolbar. */
  variant?: 'visual' | 'wysiwyg';
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
export function TiptapEditor({
  value,
  onChange,
  onUpload,
  dir = 'ltr',
  editable = true,
  className,
  style,
  comments,
  activeCommentId,
  commentMode = false,
  onAddComment,
  variant = 'visual',
}: TiptapEditorProps) {
  const lastEmitted = useRef<string>(value);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onUploadRef = useRef(onUpload);
  onUploadRef.current = onUpload;
  const editorRef = useRef<Editor | null>(null);
  // Comment state read by the CommentDecorations plugin + the click handler.
  const commentsRef = useRef<CommentMarker[]>(comments ?? []);
  commentsRef.current = comments ?? [];
  const activeCommentRef = useRef<string | null>(activeCommentId ?? null);
  activeCommentRef.current = activeCommentId ?? null;
  const commentModeRef = useRef(commentMode);
  commentModeRef.current = commentMode;
  const onAddCommentRef = useRef(onAddComment);
  onAddCommentRef.current = onAddComment;

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
      Underline,
      Subscript,
      Superscript,
      Typography,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
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
      CommentDecorations.configure({ getComments: () => commentsRef.current, getActiveId: () => activeCommentRef.current }),
    ],
    content: value,
    onCreate: ({ editor }) => {
      editorRef.current = editor;
      // Seed once with the markdown source (StarterKit treats string content as HTML;
      // tiptap-markdown's setContent parses markdown). Defer to a microtask so the React
      // NodeViews (callout/mdx blocks) this mounts don't flushSync inside React's commit.
      queueMicrotask(() => {
        if (editor.isDestroyed) {
          return;
        }
        editor.commands.setContent(value, { emitUpdate: false });
        lastEmitted.current = getMarkdown(editor);
      });
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
      handleTextInput: () => commentModeRef.current,
      handleKeyDown: (_view, event) => {
        if (!commentModeRef.current) return false;
        // Preserve selection/navigation shortcuts while preventing review mode
        // from mutating the document.
        if ((event.metaKey || event.ctrlKey) && ['a', 'c'].includes(event.key.toLowerCase())) return false;
        if (event.shiftKey && event.key.startsWith('Arrow')) return false;
        return !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown', 'Shift'].includes(event.key);
      },
      // Paste or drop an image file → upload and insert the hosted URL.
      handlePaste: (_view, event) => {
        if (commentModeRef.current) return true;
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
        if (commentModeRef.current) return true;
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
      // `emitUpdate: false` so re-seeding doesn't bounce back through onChange. Deferred
      // to a microtask so NodeView remounts don't flushSync inside React's commit.
      queueMicrotask(() => {
        if (!editor.isDestroyed) {
          editor.commands.setContent(value, { emitUpdate: false });
        }
      });
    }
  }, [value, editor]);

  // Keep editability in sync. Review mode stays contenteditable so ProseMirror
  // receives exact text selections; mutation handlers above make it read-only.
  // setEditable() defaults to firing an `update` event, which would call onChange
  // with the editor's (possibly still-empty) markdown and clobber a freshly-seeded
  // value — toggling editability is not a content edit.
  useEffect(() => {
    editor?.setEditable(editable, false);
  }, [editable, editor]);

  // Re-run the comment highlight decorations when the comments / active id change
  // (no doc change occurs, so nudge ProseMirror with an empty transaction). Defer to
  // a microtask: dispatching synchronously here can nest a flushSync inside React's
  // commit once the doc has React NodeViews (mdx/callout blocks), which React warns on.
  // biome-ignore lint/correctness/useExhaustiveDependencies: comments/activeCommentId are intentional re-render triggers (read via refs inside the plugin).
  useEffect(() => {
    if (!editor) {
      return;
    }
    queueMicrotask(() => {
      if (!editor.isDestroyed) {
        editor.view.dispatch(editor.state.tr);
      }
    });
  }, [comments, activeCommentId, editor]);

  return (
    <div className={cn('pl-editor', commentMode && 'is-comment-mode', className)} dir={dir} style={style}>
      {editor && variant === 'wysiwyg' && !commentMode ? <DocumentToolbar editor={editor} /> : null}
      {editor && !commentMode ? <EditorBubbleMenu editor={editor} /> : null}
      {editor && commentMode && onAddComment ? <CommentSelectionMenu editor={editor} onAddComment={onAddComment} /> : null}
      {editor && !commentMode && variant === 'visual' ? <BlockHandle editor={editor} dir={dir ?? 'ltr'} /> : null}
      <EditorContent editor={editor} />
    </div>
  );
}

export default TiptapEditor;
