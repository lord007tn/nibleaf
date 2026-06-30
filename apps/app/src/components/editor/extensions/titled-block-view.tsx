import { NodeViewContent, type NodeViewProps, NodeViewWrapper } from '@tiptap/react';

/**
 * Editing UI for title-bearing MDX blocks (Step / Card / Tab / Accordion / Frame):
 * a borderless title input bound to the node's `title` (or `caption`) attribute,
 * above the editable body. Cards additionally expose `icon` and `href` inputs so
 * a linkable/icon card can be authored in the WYSIWYG editor (these round-trip
 * as attributes). The class prefix is derived from the node name (`mdxStep` →
 * `pl-step`), and keystrokes in the inputs are kept from bubbling to ProseMirror.
 */
export function TitledBlockView({ node, updateAttributes, extension }: NodeViewProps) {
  const tag = extension.name.replace(/^mdx/, '');
  const base = `pl-${tag.toLowerCase()}`;
  const attr = extension.name === 'mdxFrame' ? 'caption' : 'title';
  const value = (node.attrs[attr] as string) ?? '';
  const isCard = extension.name === 'mdxCard';
  const stop = {
    onKeyDown: (event: React.KeyboardEvent) => event.stopPropagation(),
    onMouseDown: (event: React.MouseEvent) => event.stopPropagation(),
  };
  return (
    <NodeViewWrapper className={base} data-mdx={tag}>
      <input
        className={`${base}-title-input`}
        value={value}
        placeholder={attr === 'caption' ? 'Caption' : 'Title'}
        onChange={(event) => updateAttributes({ [attr]: event.target.value })}
        {...stop}
      />
      {isCard ? (
        <div className="pl-card-meta">
          <input
            className="pl-card-meta-input"
            value={(node.attrs.icon as string) ?? ''}
            placeholder="icon (e.g. rocket)"
            onChange={(event) => updateAttributes({ icon: event.target.value })}
            {...stop}
          />
          <input
            className="pl-card-meta-input"
            value={(node.attrs.href as string) ?? ''}
            placeholder="href (e.g. /quickstart)"
            onChange={(event) => updateAttributes({ href: event.target.value })}
            {...stop}
          />
        </div>
      ) : null}
      <NodeViewContent className={`${base}-body`} />
    </NodeViewWrapper>
  );
}

