import { cn } from '@nibleaf/design-system/lib/utils';
import type { MessageKey } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
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
import Typography from '@tiptap/extension-typography';
import type { Node as PMNode } from '@tiptap/pm/model';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import { common, createLowlight } from 'lowlight';
import {
  Bold,
  Code,
  GripVertical,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  ListTodo,
  MessageSquarePlus,
  Plus,
  Quote,
  Redo2,
  SquareCode,
  Strikethrough,
  Subscript as SubscriptIcon,
  Superscript as SuperscriptIcon,
  Table as TableIcon,
  Underline as UnderlineIcon,
  Undo2,
} from 'lucide-react';
import { type ComponentType, type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Markdown, type MarkdownNodeSpec } from 'tiptap-markdown';
import { CodeBlockMenu } from './code-block-menu';
import { EditorBubbleMenu, LinkEditorPanel } from './editor-bubble-menu';
import { Callout } from './extensions/callout';
import { CommentDecorations, type CommentMarker } from './extensions/comment-decorations';
import { mdxNodes } from './extensions/mdx-nodes';
import { decodeMdxSource, encodeMdxSource, opaqueMdxNodes } from './extensions/mdx-roundtrip';
import { SlashCommand } from './extensions/slash-command';
import { TableBubbleMenu } from './table-menu';
import './tiptap.css';

// Register a small set of common languages for code-block highlighting.
const lowlight = createLowlight(common);

type MarkdownSerializeState = {
  write: (text: string) => void;
  text: (text: string, shouldEscape?: boolean) => void;
  ensureNewLine: () => void;
  closeBlock: (node: PMNode) => void;
};

const fenceParsers = new WeakSet<object>();

const replaceFenceLanguage = (opening: string, language: string): string => {
  const match = /^(\s*(?:`{3,}|~{3,}))(\s*)(\S*)?(.*)$/.exec(opening);
  if (!match) return opening;
  const prefix = match[1] ?? '```';
  const rest = match[4] ?? '';
  if (!language) return `${prefix}${rest.trimStart() ? ` ${rest.trimStart()}` : ''}`;
  return `${prefix}${match[2] ?? ''}${language}${rest}`;
};

/** Typed accessor for the tiptap-markdown storage (not part of the core Storage type). */
export function getMarkdown(editor: Editor): string {
  const storage = editor.storage as { markdown?: { getMarkdown(): string } };
  return storage.markdown?.getMarkdown() ?? '';
}

/** Typed accessor for the CharacterCount storage (not part of the core Storage type). */
function getCounts(editor: Editor): { words: number; characters: number } {
  const storage = editor.storage as { characterCount?: { words(): number; characters(): number } };
  return { words: storage.characterCount?.words() ?? 0, characters: storage.characterCount?.characters() ?? 0 };
}

/** CodeBlockLowlight that mirrors the chosen language onto the <pre> as `data-language`,
 * so the dark chrome's label bar (CSS ::before) can display it. */
const CodeBlock = CodeBlockLowlight.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      sourceFenceOpen: {
        default: '',
        parseHTML: (element) => decodeMdxSource(element.firstElementChild?.getAttribute('data-mdx-fence-open')),
        rendered: false,
      },
      sourceFenceClose: {
        default: '',
        parseHTML: (element) => decodeMdxSource(element.firstElementChild?.getAttribute('data-mdx-fence-close')),
        rendered: false,
      },
      sourceFenceLanguage: {
        default: '',
        parseHTML: (element) => decodeMdxSource(element.firstElementChild?.getAttribute('data-mdx-fence-language')),
        rendered: false,
      },
    };
  },
  renderHTML({ node, HTMLAttributes }) {
    const language = node.attrs.language || null;
    return ['pre', { ...HTMLAttributes, 'data-language': language ?? 'code' }, ['code', { class: language ? `language-${language}` : undefined }, 0]];
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializeState, node: PMNode) {
          const sourceOpen = String(node.attrs.sourceFenceOpen ?? '');
          if (sourceOpen) {
            const language = String(node.attrs.language ?? '');
            const originalLanguage = String(node.attrs.sourceFenceLanguage ?? '');
            state.write(language === originalLanguage ? sourceOpen : replaceFenceLanguage(sourceOpen, language));
            state.write('\n');
            state.text(node.textContent, false);
            state.ensureNewLine();
            state.write(String(node.attrs.sourceFenceClose ?? '') || (sourceOpen.trimStart().startsWith('~') ? '~~~' : '```'));
            state.closeBlock(node);
            return;
          }
          state.write(`\`\`\`${node.attrs.language || ''}\n`);
          state.text(node.textContent, false);
          state.ensureNewLine();
          state.write('```');
          state.closeBlock(node);
        },
        parse: {
          setup(markdownit) {
            markdownit.set({ langPrefix: 'language-' });
            if (fenceParsers.has(markdownit)) return;
            markdownit.core.ruler.after('block', 'nibleaf_fence_source', (state) => {
              const lines = state.src.split('\n');
              for (const token of state.tokens) {
                if (token.type !== 'fence' || !token.map) continue;
                const open = lines[token.map[0]] ?? '';
                const close = lines[Math.max(token.map[0], token.map[1] - 1)] ?? '';
                const language = token.info.trim().split(/\s+/, 1)[0] ?? '';
                token.attrSet('data-mdx-fence-open', encodeMdxSource(open));
                token.attrSet('data-mdx-fence-close', encodeMdxSource(close));
                token.attrSet('data-mdx-fence-language', encodeMdxSource(language));
              }
            });
            fenceParsers.add(markdownit);
          },
          updateDOM(element: HTMLElement) {
            element.innerHTML = element.innerHTML.replace(/\n<\/code><\/pre>/g, '</code></pre>');
          },
        },
      } satisfies MarkdownNodeSpec,
    };
  },
});

interface BuildExtensionsOptions {
  /** Upload a picked/pasted image, returning its hosted URL (or null). */
  onUpload?: (file: File) => Promise<string | null>;
  /** Comment markers rendered as highlight decorations. */
  getComments?: () => CommentMarker[];
  /** The focused comment id (drawn stronger). */
  getActiveId?: () => string | null;
  /** Page text direction. prosemirror-tables' column-resize math is LTR-only
   *  (drag deltas are inverted under `direction: rtl`), so resizing is
   *  disabled for RTL documents. */
  dir?: 'ltr' | 'rtl';
}

/**
 * The full editor extension set — exported so the markdown round-trip tests
 * exercise the exact configuration the app ships (any extension whose content
 * does not survive `markdown → doc → markdown` is a silent data-loss bug).
 *
 * NOTE: TextAlign is intentionally absent — alignment has no Markdown syntax
 * and tiptap-markdown drops the attr on serialize, so offering it in the UI
 * would silently lose the author's formatting on save.
 */
export function buildEditorExtensions({ onUpload, getComments, getActiveId, dir = 'ltr' }: BuildExtensionsOptions = {}) {
  return [
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
    Subscript,
    Superscript,
    Typography,
    Image.configure({ inline: false, allowBase64: true }),
    TaskList,
    TaskItem.configure({ nested: true }),
    // Column resizing is LTR-only in prosemirror-tables — in RTL the drag
    // handles operate direction-inverted, so it is disabled there.
    Table.configure({ resizable: dir !== 'rtl' }),
    TableRow,
    TableHeader,
    TableCell,
    CharacterCount,
    Callout,
    ...mdxNodes,
    ...opaqueMdxNodes,
    SlashCommand.configure({ onUpload: (file: File) => onUpload?.(file) ?? Promise.resolve(null) }),
    CommentDecorations.configure({ getComments: getComments ?? (() => []), getActiveId: getActiveId ?? (() => null) }),
  ];
}

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

interface ToolbarAction {
  labelKey: MessageKey;
  icon: ComponentType<{ className?: string }>;
  active?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
  /** Marks the link button so the popover anchors under it. */
  expanded?: boolean;
  run: () => void;
}

/**
 * Persistent WYSIWYG toolbar. Text alignment is deliberately NOT offered:
 * content is Markdown end-to-end and alignment does not survive the round-trip
 * (verified in markdown-roundtrip.test.ts), so a button for it would silently
 * lose formatting on save.
 */
function DocumentToolbar({ editor }: { editor: Editor }) {
  const t = useT();
  const [linkOpen, setLinkOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  // Dismiss the link popover on pointer-down outside the toolbar container
  // (same pattern as the slash menu). Escape closes it from the input itself.
  useEffect(() => {
    if (!linkOpen) {
      return;
    }
    const dismiss = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && containerRef.current && !containerRef.current.contains(target)) {
        setLinkOpen(false);
      }
    };
    document.addEventListener('pointerdown', dismiss, true);
    return () => document.removeEventListener('pointerdown', dismiss, true);
  }, [linkOpen]);
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      canUndo: current.can().undo(),
      canRedo: current.can().redo(),
      heading1: current.isActive('heading', { level: 1 }),
      heading2: current.isActive('heading', { level: 2 }),
      heading3: current.isActive('heading', { level: 3 }),
      bold: current.isActive('bold'),
      italic: current.isActive('italic'),
      underline: current.isActive('underline'),
      strike: current.isActive('strike'),
      code: current.isActive('code'),
      highlight: current.isActive('highlight'),
      subscript: current.isActive('subscript'),
      superscript: current.isActive('superscript'),
      bulletList: current.isActive('bulletList'),
      orderedList: current.isActive('orderedList'),
      taskList: current.isActive('taskList'),
      blockquote: current.isActive('blockquote'),
      link: current.isActive('link'),
      href: (current.getAttributes('link').href as string | undefined) ?? '',
      codeBlock: current.isActive('codeBlock'),
      canInsertTable: current.can().insertTable(),
    }),
  });
  const actions: ToolbarAction[] = [
    { labelKey: 'editor.toolbar.undo', icon: Undo2, run: () => editor.chain().focus().undo().run(), disabled: !state.canUndo },
    { labelKey: 'editor.toolbar.redo', icon: Redo2, run: () => editor.chain().focus().redo().run(), disabled: !state.canRedo },
    {
      labelKey: 'editor.slash.h1.title',
      icon: Heading1,
      active: state.heading1,
      run: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
      separatorBefore: true,
    },
    {
      labelKey: 'editor.slash.h2.title',
      icon: Heading2,
      active: state.heading2,
      run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      labelKey: 'editor.slash.h3.title',
      icon: Heading3,
      active: state.heading3,
      run: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
    },
    { labelKey: 'editor.format.bold', icon: Bold, active: state.bold, run: () => editor.chain().focus().toggleBold().run(), separatorBefore: true },
    { labelKey: 'editor.format.italic', icon: Italic, active: state.italic, run: () => editor.chain().focus().toggleItalic().run() },
    { labelKey: 'editor.format.underline', icon: UnderlineIcon, active: state.underline, run: () => editor.chain().focus().toggleUnderline().run() },
    { labelKey: 'editor.format.strikethrough', icon: Strikethrough, active: state.strike, run: () => editor.chain().focus().toggleStrike().run() },
    { labelKey: 'editor.format.code', icon: Code, active: state.code, run: () => editor.chain().focus().toggleCode().run() },
    { labelKey: 'editor.format.highlight', icon: Highlighter, active: state.highlight, run: () => editor.chain().focus().toggleHighlight().run() },
    {
      labelKey: 'editor.format.subscript',
      icon: SubscriptIcon,
      active: state.subscript,
      run: () => editor.chain().focus().toggleSubscript().run(),
    },
    {
      labelKey: 'editor.format.superscript',
      icon: SuperscriptIcon,
      active: state.superscript,
      run: () => editor.chain().focus().toggleSuperscript().run(),
    },
    {
      labelKey: 'editor.slash.bulletList.title',
      icon: List,
      active: state.bulletList,
      run: () => editor.chain().focus().toggleBulletList().run(),
      separatorBefore: true,
    },
    {
      labelKey: 'editor.slash.numberedList.title',
      icon: ListOrdered,
      active: state.orderedList,
      run: () => editor.chain().focus().toggleOrderedList().run(),
    },
    { labelKey: 'editor.slash.todo.title', icon: ListTodo, active: state.taskList, run: () => editor.chain().focus().toggleTaskList().run() },
    { labelKey: 'editor.slash.quote.title', icon: Quote, active: state.blockquote, run: () => editor.chain().focus().toggleBlockquote().run() },
    {
      labelKey: 'editor.format.link',
      icon: LinkIcon,
      active: state.link,
      run: () => setLinkOpen((open) => !open),
      expanded: linkOpen,
      separatorBefore: true,
    },
    {
      labelKey: 'editor.slash.table.title',
      icon: TableIcon,
      disabled: !state.canInsertTable,
      run: () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
      separatorBefore: true,
    },
    {
      labelKey: 'editor.slash.codeBlock.title',
      icon: SquareCode,
      active: state.codeBlock,
      run: () => editor.chain().focus().toggleCodeBlock().run(),
    },
  ];
  return (
    <div ref={containerRef} className="sticky top-0 z-10 mb-5">
      <div className="flex min-h-11 items-center gap-0.5 overflow-x-auto rounded-xl border border-border bg-background/95 p-1.5 shadow-sm backdrop-blur">
        {actions.map(({ labelKey, icon: Icon, active = false, run, disabled, separatorBefore, expanded }) => {
          const label = t(labelKey);
          return (
            <span key={labelKey} className="flex shrink-0 items-center gap-0.5">
              {separatorBefore ? <span className="ms-1 me-0.5 h-5 w-px bg-border" /> : null}
              <button
                type="button"
                title={label}
                aria-label={label}
                aria-pressed={active}
                aria-expanded={expanded}
                disabled={disabled}
                onMouseDown={(event) => event.preventDefault()}
                onClick={run}
                className={cn(
                  'grid size-8 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40',
                  active && 'bg-muted text-foreground',
                )}
              >
                <Icon className="size-4" />
              </button>
            </span>
          );
        })}
      </div>
      {/* Link popover — anchored under the toolbar (the row scrolls horizontally,
          so an in-row popover would be clipped by overflow-x). */}
      {linkOpen ? (
        <div className="absolute start-1 top-full mt-1 rounded-lg border border-border bg-card p-1 shadow-lg">
          <LinkEditorPanel editor={editor} initialUrl={state.href} onDone={() => setLinkOpen(false)} autoFocus />
        </div>
      ) : null}
    </div>
  );
}

/** Word + character count, pinned to the corner of the editor viewport. */
function EditorFooter({ editor }: { editor: Editor }) {
  const t = useT();
  const counts = useEditorState({ editor, selector: ({ editor: current }) => getCounts(current) });
  return (
    <div className="pointer-events-none sticky bottom-3 z-10 flex justify-end">
      <span className="rounded-full border border-border bg-background/85 px-2.5 py-1 text-[11px] text-muted-foreground tabular-nums shadow-sm backdrop-blur">
        {t('editor.wordCount', { words: counts.words, characters: counts.characters })}
      </span>
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
  const onUploadRef = useRef(onUpload);
  const editorRef = useRef<Editor | null>(null);
  // Comment state read by the CommentDecorations plugin + the click handler.
  const commentsRef = useRef<CommentMarker[]>(comments ?? []);
  const activeCommentRef = useRef<string | null>(activeCommentId ?? null);
  const commentModeRef = useRef(commentMode);
  const onAddCommentRef = useRef(onAddComment);
  useEffect(() => {
    onChangeRef.current = onChange;
    onUploadRef.current = onUpload;
    commentsRef.current = comments ?? [];
    activeCommentRef.current = activeCommentId ?? null;
    commentModeRef.current = commentMode;
    onAddCommentRef.current = onAddComment;
  }, [activeCommentId, commentMode, comments, onAddComment, onChange, onUpload]);

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

  const editor = useEditor(
    {
      editable,
      extensions: buildEditorExtensions({
        onUpload: (file: File) => onUploadRef.current?.(file) ?? Promise.resolve(null),
        getComments: () => commentsRef.current,
        getActiveId: () => activeCommentRef.current,
        dir,
      }),
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
    },
    // Rebuild the editor (and its extension set) when the page direction flips —
    // table resizability is baked into the Table extension configuration.
    [dir],
  );

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
      {editor && !commentMode ? <TableBubbleMenu editor={editor} /> : null}
      {editor && !commentMode ? <CodeBlockMenu editor={editor} /> : null}
      {editor && commentMode && onAddComment ? <CommentSelectionMenu editor={editor} onAddComment={onAddComment} /> : null}
      {editor && !commentMode && variant === 'visual' ? <BlockHandle editor={editor} dir={dir ?? 'ltr'} /> : null}
      <EditorContent editor={editor} />
      {editor && editable && !commentMode ? <EditorFooter editor={editor} /> : null}
    </div>
  );
}

export default TiptapEditor;
