import { cn } from '@nibleaf/design-system/lib/utils';
import type { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';
import { useEditorState } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { Bold, Check, Code, ExternalLink, Highlighter, Italic, Link as LinkIcon, Strikethrough, Unlink } from 'lucide-react';
import { type ComponentType, useEffect, useState } from 'react';
import { useT } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { normalizeLinkUrl } from './link-utils';

interface EditorBubbleMenuProps {
  editor: Editor;
}

interface MarkButton {
  labelKey: MessageKey;
  icon: ComponentType<{ className?: string }>;
  active: boolean;
  run: () => void;
}

/**
 * Inline link editor: shows the current URL prefilled with Save / Open / Remove
 * actions. Used inside the selection bubble menu and the WYSIWYG toolbar popover.
 * URLs are validated (http(s), mailto:, tel:, #anchor, /relative) — unsafe
 * schemes like javascript: are rejected inline instead of being silently saved.
 */
export function LinkEditorPanel({
  editor,
  initialUrl,
  onDone,
  autoFocus = false,
}: {
  editor: Editor;
  initialUrl: string;
  onDone: () => void;
  /** Focus the URL field on mount — only when the panel was opened explicitly,
   *  never when it appears because the caret moved into a link. */
  autoFocus?: boolean;
}) {
  const t = useT();
  const [draft, setDraft] = useState(initialUrl);
  const [invalid, setInvalid] = useState(false);
  // Re-seed when the caret moves to a different link (the prefilled URL changes).
  useEffect(() => {
    setDraft(initialUrl);
    setInvalid(false);
  }, [initialUrl]);

  const save = () => {
    const href = normalizeLinkUrl(draft);
    if (!href) {
      setInvalid(true);
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
    onDone();
  };
  const remove = () => {
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    onDone();
  };
  const normalized = normalizeLinkUrl(draft);
  // Relative destinations ('/x', '#x', './x', 'getting-started') would resolve
  // against the dashboard origin, not the published site — only absolute URLs
  // (which always carry a scheme after normalization) are openable from here.
  const openHref =
    normalized && !normalized.startsWith('/') && !normalized.startsWith('#') && /^[a-z][a-z0-9+.-]*:/i.test(normalized) ? normalized : null;
  const iconButton =
    'flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-foreground/80 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <div className="flex items-center gap-1 p-0.5">
      <input
        // biome-ignore lint/a11y/noAutofocus: only set when the panel opens from an explicit user action — focusing the URL field is the point.
        autoFocus={autoFocus}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          setInvalid(false);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            save();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            onDone();
            editor.commands.focus();
          }
        }}
        dir="ltr"
        placeholder="https://…  /page  #anchor"
        aria-label={t('editor.format.linkPrompt')}
        aria-invalid={invalid}
        title={invalid ? t('editor.link.invalid') : undefined}
        className={cn(
          'h-7 w-56 rounded-md border bg-background px-2 font-mono text-[12px] text-foreground outline-none placeholder:text-muted-foreground/60',
          invalid ? 'border-destructive focus:ring-2 focus:ring-destructive/30' : 'border-border focus:ring-2 focus:ring-ring/40',
        )}
      />
      <button type="button" title={t('editor.link.save')} aria-label={t('editor.link.save')} onClick={save} className={iconButton}>
        <Check className="size-4" />
      </button>
      <button
        type="button"
        title={normalized && !openHref ? t('editor.link.openRelativeHint') : t('editor.link.open')}
        aria-label={t('editor.link.open')}
        disabled={!openHref}
        onClick={() => {
          if (openHref) {
            window.open(openHref, '_blank', 'noopener,noreferrer');
          }
        }}
        className={iconButton}
      >
        <ExternalLink className="size-4" />
      </button>
      {editor.isActive('link') ? (
        <button type="button" title={t('editor.link.remove')} aria-label={t('editor.link.remove')} onClick={remove} className={iconButton}>
          <Unlink className="size-4" />
        </button>
      ) : null}
    </div>
  );
}

/**
 * Inline formatting toolbar that floats above the current text selection:
 * bold / italic / strike / code / highlight / link. Also appears when the
 * caret rests inside a link (as a link inspector with the URL prefilled).
 */
export function EditorBubbleMenu({ editor }: EditorBubbleMenuProps) {
  const t = useT();
  const [linkOpen, setLinkOpen] = useState(false);
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current.isActive('bold'),
      italic: current.isActive('italic'),
      strike: current.isActive('strike'),
      code: current.isActive('code'),
      highlight: current.isActive('highlight'),
      link: current.isActive('link'),
      href: (current.getAttributes('link').href as string | undefined) ?? '',
      empty: current.state.selection.empty,
    }),
  });

  // Caret inside a link (no selection) → the menu acts as a link inspector.
  const inspectingLink = state.link && state.empty;
  const showLinkPanel = linkOpen || inspectingLink;

  // Reset the manual panel when the selection leaves link territory.
  useEffect(() => {
    if (state.empty && !state.link) {
      setLinkOpen(false);
    }
  }, [state.empty, state.link]);

  const buttons: MarkButton[] = [
    { labelKey: 'editor.format.bold', icon: Bold, active: state.bold, run: () => editor.chain().focus().toggleBold().run() },
    { labelKey: 'editor.format.italic', icon: Italic, active: state.italic, run: () => editor.chain().focus().toggleItalic().run() },
    { labelKey: 'editor.format.strikethrough', icon: Strikethrough, active: state.strike, run: () => editor.chain().focus().toggleStrike().run() },
    { labelKey: 'editor.format.code', icon: Code, active: state.code, run: () => editor.chain().focus().toggleCode().run() },
    { labelKey: 'editor.format.highlight', icon: Highlighter, active: state.highlight, run: () => editor.chain().focus().toggleHighlight().run() },
  ];

  return (
    <BubbleMenu
      editor={editor}
      pluginKey="nibleaf-text-menu"
      options={{ placement: 'top' }}
      // Show for a text selection (the classic formatting bar) or whenever the
      // caret is inside a link (link inspector). Never inside code blocks —
      // those have their own language menu and marks don't apply there.
      shouldShow={({ editor: current }) => {
        if (!current.isEditable || current.isActive('codeBlock')) {
          return false;
        }
        // Table cell selections get the table menu only — bail before the link
        // early-return so both menus never stack over the same selection.
        if (current.state.selection instanceof CellSelection) {
          return false;
        }
        if (current.isActive('link')) {
          return true;
        }
        const { selection } = current.state;
        return !selection.empty && !(selection instanceof NodeSelection);
      }}
      className="flex flex-col rounded-lg border border-border bg-card p-1 shadow-lg"
    >
      {!inspectingLink ? (
        <div className="flex items-center gap-0.5">
          {buttons.map((button) => {
            const Icon = button.icon;
            const label = t(button.labelKey);
            return (
              <button
                type="button"
                key={button.labelKey}
                title={label}
                aria-label={label}
                aria-pressed={button.active}
                onMouseDown={(event) => event.preventDefault()}
                onClick={button.run}
                className={cn(
                  'flex size-7 cursor-pointer items-center justify-center rounded-md text-foreground/80 hover:bg-muted',
                  button.active && 'bg-muted text-foreground',
                )}
              >
                <Icon className="size-4" />
              </button>
            );
          })}
          <span className="mx-0.5 h-5 w-px bg-border" />
          <button
            type="button"
            title={t('editor.format.link')}
            aria-label={t('editor.format.link')}
            aria-pressed={state.link}
            aria-expanded={showLinkPanel}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setLinkOpen((open) => !open)}
            className={cn(
              'flex size-7 cursor-pointer items-center justify-center rounded-md text-foreground/80 hover:bg-muted',
              state.link && 'bg-muted text-foreground',
            )}
          >
            <LinkIcon className="size-4" />
          </button>
        </div>
      ) : null}
      {showLinkPanel ? <LinkEditorPanel editor={editor} initialUrl={state.href} onDone={() => setLinkOpen(false)} autoFocus={linkOpen} /> : null}
    </BubbleMenu>
  );
}

export default EditorBubbleMenu;
