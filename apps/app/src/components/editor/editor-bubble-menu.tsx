import type { Editor } from '@tiptap/core';
import { BubbleMenu } from '@tiptap/react/menus';
import { Bold, Code, Highlighter, Italic, Link as LinkIcon, Strikethrough } from 'lucide-react';
import type { ComponentType } from 'react';
import { usePrompt } from '@/components/ui/confirm';
import { useT } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { cn } from '@/lib/utils';

interface EditorBubbleMenuProps {
  editor: Editor;
}

interface MarkButton {
  labelKey: MessageKey;
  icon: ComponentType<{ className?: string }>;
  isActive: () => boolean;
  run: () => void;
}

/**
 * Inline formatting toolbar that floats above the current text selection:
 * bold / italic / strike / code / highlight / link.
 */
export function EditorBubbleMenu({ editor }: EditorBubbleMenuProps) {
  const t = useT();
  const prompt = usePrompt();
  const buttons: MarkButton[] = [
    { labelKey: 'editor.format.bold', icon: Bold, isActive: () => editor.isActive('bold'), run: () => editor.chain().focus().toggleBold().run() },
    {
      labelKey: 'editor.format.italic',
      icon: Italic,
      isActive: () => editor.isActive('italic'),
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      labelKey: 'editor.format.strikethrough',
      icon: Strikethrough,
      isActive: () => editor.isActive('strike'),
      run: () => editor.chain().focus().toggleStrike().run(),
    },
    { labelKey: 'editor.format.code', icon: Code, isActive: () => editor.isActive('code'), run: () => editor.chain().focus().toggleCode().run() },
    {
      labelKey: 'editor.format.highlight',
      icon: Highlighter,
      isActive: () => editor.isActive('highlight'),
      run: () => editor.chain().focus().toggleHighlight().run(),
    },
  ];

  const toggleLink = async () => {
    if (editor.isActive('link')) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    const previous = (editor.getAttributes('link').href as string) ?? '';
    const url = await prompt({
      title: t('editor.format.link'),
      label: t('editor.format.linkPrompt'),
      placeholder: 'https://example.com',
      initialValue: previous,
    });
    if (!url) {
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

  return (
    <BubbleMenu
      editor={editor}
      options={{ placement: 'top' }}
      className="flex items-center gap-0.5 rounded-lg border border-border bg-card p-1 shadow-lg"
    >
      {buttons.map((button) => {
        const Icon = button.icon;
        const label = t(button.labelKey);
        return (
          <button
            type="button"
            key={button.labelKey}
            title={label}
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
        title={t('editor.format.link')}
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
