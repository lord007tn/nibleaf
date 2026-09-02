import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@nibleaf/design-system/components/ui/select';
import { useT } from '@nibleaf/i18n/react';
import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';

/** Curated fence languages (lowlight `common` grammars + mermaid). The value is
 *  what lands after the ``` fence in Markdown, so it must stay highlightable on
 *  the live site too. */
const CODE_BLOCK_LANGUAGES = [
  'bash',
  'c',
  'cpp',
  'csharp',
  'css',
  'diff',
  'go',
  'graphql',
  'html',
  'java',
  'javascript',
  'json',
  'kotlin',
  'markdown',
  'mermaid',
  'php',
  'python',
  'ruby',
  'rust',
  'shell',
  'sql',
  'swift',
  'typescript',
  'xml',
  'yaml',
] as const;

/**
 * Floating language switcher shown while the caret is inside a code block.
 * Sets the codeBlock `language` attr, which drives lowlight highlighting, the
 * chrome's data-language label, and the ```lang fence on Markdown save.
 */
export function CodeBlockMenu({ editor }: { editor: Editor }) {
  const t = useT();
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      active: current.isActive('codeBlock'),
      language: (current.getAttributes('codeBlock').language as string | null | undefined) ?? '',
    }),
  });

  // Preserve a language that came from imported Markdown but is not in the curated list.
  const known = CODE_BLOCK_LANGUAGES.includes(state.language as (typeof CODE_BLOCK_LANGUAGES)[number]);
  const items: Array<{ value: string; label: string }> = [
    { value: '', label: t('editor.codeBlock.plain') },
    ...(state.language && !known ? [{ value: state.language, label: state.language }] : []),
    ...CODE_BLOCK_LANGUAGES.map((language) => ({ value: language, label: language })),
  ];

  return (
    <BubbleMenu
      editor={editor}
      pluginKey="nibleaf-code-block-menu"
      options={{ placement: 'top-end' }}
      shouldShow={({ editor: current }) => current.isEditable && current.isActive('codeBlock')}
      className="rounded-lg border border-border bg-card p-1 shadow-lg"
    >
      <Select
        items={items}
        onValueChange={(next) => {
          editor
            .chain()
            .focus()
            .updateAttributes('codeBlock', { language: next || null })
            .run();
        }}
        value={state.language}
      >
        <SelectTrigger
          aria-label={t('editor.codeBlock.language')}
          className="h-7 font-mono text-[12px]"
          dir="ltr"
          size="sm"
          title={t('editor.codeBlock.language')}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="font-mono text-[12px]" dir="ltr">
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </BubbleMenu>
  );
}
