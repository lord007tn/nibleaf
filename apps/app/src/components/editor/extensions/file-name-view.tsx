import { useLocale } from '@nibleaf/i18n/react';
import { NodeViewContent, type NodeViewProps, NodeViewWrapper } from '@tiptap/react';
import { z } from 'zod';

const editorAttribute = z.string().catch('');

/**
 * A File in a file tree (#670): its name is text in the page, where the caret
 * goes (typing after inserting a File tree names the first file), with a
 * placeholder while it is empty. It reads in its own direction (`dir="auto"`),
 * so an Arabic name is right to left and `src/index.ts` left to right in any
 * interface. Its icon stays an attribute field below it, as before.
 */
export function FileNameView({ node, updateAttributes, editor }: NodeViewProps) {
  const { t } = useLocale();
  // A read-only editor (Viewers) shows the name but offers nothing to change.
  const readOnly = !editor.isEditable;
  const empty = node.content.size === 0;
  const stop = {
    onKeyDown: (event: React.KeyboardEvent) => event.stopPropagation(),
    onMouseDown: (event: React.MouseEvent) => event.stopPropagation(),
  };
  return (
    <NodeViewWrapper className="pl-file" data-mdx="File">
      <NodeViewContent className={empty ? 'pl-file-name is-empty' : 'pl-file-name'} data-placeholder={t('editor.block.namePlaceholder')} dir="auto" />
      {readOnly ? null : (
        <div className="pl-card-meta" contentEditable={false}>
          <input
            className="pl-card-meta-input"
            data-attribute="icon"
            dir="ltr"
            value={editorAttribute.parse(node.attrs.icon)}
            aria-label={t('editor.block.iconPlaceholder')}
            placeholder={t('editor.block.iconPlaceholder')}
            onChange={(event) => updateAttributes({ icon: event.target.value })}
            {...stop}
          />
        </div>
      )}
    </NodeViewWrapper>
  );
}
