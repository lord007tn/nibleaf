import { useT } from '@nibleaf/i18n/react';
import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';

/** Curated fence languages (lowlight `common` grammars + mermaid). The value is
 *  what lands after the ``` fence in Markdown, so it must stay highlightable on
 *  the live site too. */
export const CODE_BLOCK_LANGUAGES = [
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

  return (
    <BubbleMenu
      editor={editor}
      pluginKey="nibleaf-code-block-menu"
      options={{ placement: 'top-end' }}
      shouldShow={({ editor: current }) => current.isEditable && current.isActive('codeBlock')}
      className="rounded-lg border border-border bg-card p-1 shadow-lg"
    >
      <select
        value={state.language}
        onChange={(event) => {
          const language = event.target.value || null;
          editor.chain().focus().updateAttributes('codeBlock', { language }).run();
        }}
        aria-label={t('editor.codeBlock.language')}
        title={t('editor.codeBlock.language')}
        className="h-7 cursor-pointer rounded-md border border-border bg-background px-1.5 font-mono text-[12px] text-foreground outline-none focus:ring-2 focus:ring-ring/40"
      >
        <option value="">{t('editor.codeBlock.plain')}</option>
        {/* Preserve a language that came from imported Markdown but is not in the curated list. */}
        {state.language && !CODE_BLOCK_LANGUAGES.includes(state.language as (typeof CODE_BLOCK_LANGUAGES)[number]) ? (
          <option value={state.language}>{state.language}</option>
        ) : null}
        {CODE_BLOCK_LANGUAGES.map((language) => (
          <option key={language} value={language}>
            {language}
          </option>
        ))}
      </select>
    </BubbleMenu>
  );
}

export default CodeBlockMenu;
