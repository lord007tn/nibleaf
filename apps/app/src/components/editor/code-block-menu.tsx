import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@nibleaf/design-system/components/ui/select';
import { useT } from '@nibleaf/i18n/react';
import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { useMemo } from 'react';
import { blockAnchor, MENU_EDGE_PADDING, useMenuScrollTarget } from './menu-anchor';

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
  const anchor = useMemo(() => blockAnchor(editor, 'pre'), [editor]);
  const scrollTarget = useMenuScrollTarget();
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
      data-editor-bubble-menu=""
      editor={editor}
      pluginKey="nibleaf-code-block-menu"
      // Inside the block's top corner, on the row of its language label: never
      // over the line being typed, nor over the block above.
      getReferencedVirtualElement={anchor}
      options={{
        placement: 'top-end',
        offset: ({ rects }) => ({ mainAxis: -rects.floating.height - 4, alignmentAxis: 6 }),
        flip: false,
        shift: { padding: MENU_EDGE_PADDING },
        scrollTarget,
      }}
      shouldShow={({ editor: current }) => current.isEditable && current.isActive('codeBlock')}
      className="rounded-md border border-border bg-card shadow-sm"
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
