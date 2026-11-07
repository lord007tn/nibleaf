import type { MessageKey } from '@nibleaf/i18n';
import { useLocale } from '@nibleaf/i18n/react';
import { NodeViewContent, type NodeViewProps, NodeViewWrapper } from '@tiptap/react';
import { z } from 'zod';
import { hasIcon, PageIcon } from '@/components/site/page-icon';
import { componentNameKey, componentTagOf, inlineAttributeOf } from '../component-settings/schema';

const placeholderByAttribute: Record<string, MessageKey> = {
  title: 'editor.block.titlePlaceholder',
  caption: 'editor.block.captionPlaceholder',
  name: 'editor.block.namePlaceholder',
};

const editorAttribute = z.string().catch('');
const EMOJI = /\p{Extended_Pictographic}/u;

/**
 * Editing UI for title-bearing MDX blocks (Step / Card / Tab / Accordion / Frame…):
 * a borderless title input bound to the node's `title` (or `caption`/`name`)
 * attribute, above the editable body. Every other attribute (icon, link,
 * description, status…) is edited in the component settings panel; a compact
 * summary of the ones that are set opens it. The class prefix is derived from
 * the node name (`mdxStep` → `pl-step`), and keystrokes in the input are kept
 * from bubbling to ProseMirror.
 */
export function TitledBlockView({ node, updateAttributes, extension, editor, getPos }: NodeViewProps) {
  const { t } = useLocale();
  const tag = extension.name.replace(/^mdx/, '');
  const base = `pl-${tag.toLowerCase()}`;
  const attr = inlineAttributeOf(extension.name) ?? 'title';
  const value = editorAttribute.parse(node.attrs[attr]);
  const placeholder = t(placeholderByAttribute[attr] ?? 'editor.block.titlePlaceholder');
  const icon = editorAttribute.parse(node.attrs.icon);
  const href = editorAttribute.parse(node.attrs.href);
  const status = editorAttribute.parse(node.attrs.status);
  const description = editorAttribute.parse(node.attrs.description);
  const hasSummary = Boolean(icon || href || status || description);
  const nameKey = componentNameKey(componentTagOf(extension.name) ?? tag);
  const openSettings = () => {
    const pos = typeof getPos === 'function' ? getPos() : undefined;
    const tagName = componentTagOf(extension.name);
    if (pos === undefined || !tagName) return;
    editor.storage.componentSettings?.open?.({ pos, nodeName: extension.name, tag: tagName });
  };
  const stop = {
    onKeyDown: (event: React.KeyboardEvent) => event.stopPropagation(),
    onMouseDown: (event: React.MouseEvent) => event.stopPropagation(),
  };
  return (
    <NodeViewWrapper className={base} data-mdx={tag}>
      <input
        className={`${base}-title-input`}
        value={value}
        aria-label={placeholder}
        placeholder={placeholder}
        onChange={(event) => updateAttributes({ [attr]: event.target.value })}
        {...stop}
      />
      {hasSummary ? (
        <button
          type="button"
          className="pl-block-summary"
          contentEditable={false}
          aria-label={t('editor.componentSettings.buttonLabel', { component: nameKey ? t(nameKey) : tag })}
          onClick={openSettings}
          {...stop}
        >
          {icon ? (
            <span className="pl-block-summary-icon" aria-hidden>
              {hasIcon(icon) ? <PageIcon name={icon} className="size-3.5" /> : EMOJI.test(icon) ? icon : null}
            </span>
          ) : null}
          {status ? <span dir="ltr">{status}</span> : null}
          {href ? (
            <span className="pl-block-summary-link" dir="ltr">
              {href}
            </span>
          ) : null}
          {description ? (
            <span className="pl-block-summary-text" dir="auto">
              {description}
            </span>
          ) : null}
        </button>
      ) : null}
      {node.isLeaf ? null : <NodeViewContent className={`${base}-body`} />}
    </NodeViewWrapper>
  );
}
