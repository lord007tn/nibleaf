import type { Editor } from '@tiptap/core';
import { BubbleMenu } from '@tiptap/react/menus';
import { Bold, Code, Highlighter, Italic, Link as LinkIcon, Strikethrough } from 'lucide-react';
import type { ComponentType } from 'react';
import { cn } from '@/lib/utils';

interface EditorBubbleMenuProps {
  editor: Editor;
}

interface MarkButton {
  label: string;
  icon: ComponentType<{ className?: string }>;
  isActive: () => boolean;
  run: () => void;
}

/**
 * Inline formatting toolbar that floats above the current text selection:
 * bold / italic / strike / code / highlight / link.
 */
export function EditorBubbleMenu({ editor }: EditorBubbleMenuProps) {
  const buttons: MarkButton[] = [
    { label: 'Bold', icon: Bold, isActive: () => editor.isActive('bold'), run: () => editor.chain().focus().toggleBold().run() },
    { label: 'Italic', icon: Italic, isActive: () => editor.isActive('italic'), run: () => editor.chain().focus().toggleItalic().run() },
    {
      label: 'Strikethrough',
      icon: Strikethrough,
      isActive: () => editor.isActive('strike'),
      run: () => editor.chain().focus().toggleStrike().run(),
    },
    { label: 'Code', icon: Code, isActive: () => editor.isActive('code'), run: () => editor.chain().focus().toggleCode().run() },
    {
      label: 'Highlight',
      icon: Highlighter,
      isActive: () => editor.isActive('highlight'),
      run: () => editor.chain().focus().toggleHighlight().run(),
    },
  ];

  const toggleLink = () => {
    if (editor.isActive('link')) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    const previous = (editor.getAttributes('link').href as string) ?? '';
    const url = window.prompt('Link URL', previous);
    if (url === null) {
      return;
    }
    if (url.trim() === '') {
      editor.chain().focus().unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run();
  };

  return (
    <BubbleMenu
      editor={editor}
      options={{ placement: 'top' }}
      className="flex items-center gap-0.5 rounded-lg border border-border bg-card p-1 shadow-lg"
    >
      {buttons.map((button) => {
        const Icon = button.icon;
        return (
          <button
            type="button"
            key={button.label}
            title={button.label}
            aria-pressed={button.isActive()}
            onClick={button.run}
            className={cn(
              'flex size-7 cursor-pointer items-center justify-center rounded-md text-foreground/80 hover:bg-muted',
              button.isActive() && 'bg-muted text-foreground',
            )}
          >
            <Icon className="size-4" />
          </button>
        );
      })}
      <span className="mx-0.5 h-5 w-px bg-border" />
      <button
        type="button"
        title="Link"
        aria-pressed={editor.isActive('link')}
        onClick={toggleLink}
        className={cn(
          'flex size-7 cursor-pointer items-center justify-center rounded-md text-foreground/80 hover:bg-muted',
          editor.isActive('link') && 'bg-muted text-foreground',
        )}
      >
        <LinkIcon className="size-4" />
      </button>
    </BubbleMenu>
  );
}

export default EditorBubbleMenu;
