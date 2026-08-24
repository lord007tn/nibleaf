import type { MessageKey } from '@nibleaf/i18n';
import { useLocale } from '@nibleaf/i18n/react';
import { NodeViewContent, type NodeViewProps, NodeViewWrapper } from '@tiptap/react';
import { z } from 'zod';

type EditableAttribute = 'title' | 'caption' | 'name' | 'icon' | 'href' | 'description' | 'status';

const placeholderByAttribute: Record<EditableAttribute, MessageKey> = {
  title: 'editor.block.titlePlaceholder',
  caption: 'editor.block.captionPlaceholder',
  name: 'editor.block.namePlaceholder',
  icon: 'editor.block.iconPlaceholder',
  href: 'editor.block.hrefPlaceholder',
  description: 'editor.block.descriptionPlaceholder',
  status: 'editor.block.statusPlaceholder',
};

const editorAttribute = z.string().catch('');

/**
 * Editing UI for title-bearing MDX blocks (Step / Card / Tab / Accordion / Frame):
 * a borderless title input bound to the node's `title` (or `caption`) attribute,
 * above the editable body. Cards additionally expose `icon` and `href` inputs so
 * a linkable/icon card can be authored in the WYSIWYG editor (these round-trip
 * as attributes). The class prefix is derived from the node name (`mdxStep` →
 * `pl-step`), and keystrokes in the inputs are kept from bubbling to ProseMirror.
 */
export function TitledBlockView({ node, updateAttributes, extension }: NodeViewProps) {
  const { t } = useLocale();
  const tag = extension.name.replace(/^mdx/, '');
  const base = `pl-${tag.toLowerCase()}`;
  const attr: EditableAttribute =
    extension.name === 'mdxFrame' ? 'caption' : extension.name === 'mdxFolder' || extension.name === 'mdxFile' ? 'name' : 'title';
  const value = editorAttribute.parse(node.attrs[attr]);
  const extraAttributes: EditableAttribute[] =
    extension.name === 'mdxCard'
      ? ['icon', 'href']
      : extension.name === 'mdxFile'
        ? ['icon']
        : extension.name === 'mdxResponseExample'
          ? ['status']
          : extension.name === 'mdxRelatedCard'
            ? ['description', 'icon', 'href']
            : [];
  const stop = {
    onKeyDown: (event: React.KeyboardEvent) => event.stopPropagation(),
    onMouseDown: (event: React.MouseEvent) => event.stopPropagation(),
  };
  return (
    <NodeViewWrapper className={base} data-mdx={tag}>
      <input
        className={`${base}-title-input`}
        value={value}
        aria-label={t(placeholderByAttribute[attr])}
        placeholder={t(placeholderByAttribute[attr])}
        onChange={(event) => updateAttributes({ [attr]: event.target.value })}
        {...stop}
      />
      {extraAttributes.length > 0 ? (
        <div className="pl-card-meta">
          {extraAttributes.map((extraAttribute) => (
            <input
              className="pl-card-meta-input"
              key={extraAttribute}
              value={editorAttribute.parse(node.attrs[extraAttribute])}
              aria-label={t(placeholderByAttribute[extraAttribute])}
              placeholder={t(placeholderByAttribute[extraAttribute])}
              onChange={(event) => updateAttributes({ [extraAttribute]: event.target.value })}
              {...stop}
            />
          ))}
        </div>
      ) : null}
      {node.isLeaf ? null : <NodeViewContent className={`${base}-body`} />}
    </NodeViewWrapper>
  );
}
