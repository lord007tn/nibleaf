import { NodeViewContent, type NodeViewProps, NodeViewWrapper } from '@tiptap/react';

/**
 * Editing UI for title-bearing MDX blocks (Step / Card / Tab / Accordion / Frame):
 * a borderless title input bound to the node's `title` (or `caption`) attribute,
 * above the editable body. The class prefix is derived from the node name
 * (`mdxStep` → `pl-step`), and keystrokes in the input are kept from bubbling to
 * ProseMirror. Round-trip is unaffected — the title travels as an attribute.
 */
export function TitledBlockView({ node, updateAttributes, extension }: NodeViewProps) {
  const tag = extension.name.replace(/^mdx/, '');
  const base = `pl-${tag.toLowerCase()}`;
  const attr = extension.name === 'mdxFrame' ? 'caption' : 'title';
  const value = (node.attrs[attr] as string) ?? '';
  return (
    <NodeViewWrapper className={base} data-mdx={tag}>
      <input
        className={`${base}-title-input`}
        value={value}
        placeholder={attr === 'caption' ? 'Caption' : 'Title'}
        onChange={(event) => updateAttributes({ [attr]: event.target.value })}
        onKeyDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
      />
      <NodeViewContent className={`${base}-body`} />
    </NodeViewWrapper>
  );
}
