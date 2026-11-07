import { boolAttr, containerNode, inlineWrapperNode, numberAttr, stringAttrs } from './factories';

// ─── Layout and inline UI ────────────────────────────────────────────────────
export const Columns = containerNode({
  name: 'mdxColumns',
  tag: 'Columns',
  content: 'mdxColumn+',
  className: 'pl-columns',
  attrs: numberAttr('cols'),
  attrKeys: ['cols'],
});
export const Column = containerNode({ name: 'mdxColumn', tag: 'Column', content: 'block+', className: 'pl-column' });
export const Banner = containerNode({
  name: 'mdxBanner',
  tag: 'Banner',
  content: 'block+',
  className: 'pl-banner',
  attrs: stringAttrs('type', 'dismissible'),
  attrKeys: ['type', 'dismissible'],
});
export const Badge = inlineWrapperNode({
  name: 'mdxBadge',
  tag: 'Badge',
  className: 'pl-badge',
  attrs: { ...stringAttrs('color', 'size', 'shape', 'icon'), ...boolAttr('stroke'), ...boolAttr('disabled') },
  attrKeys: ['color', 'size', 'shape', 'icon', 'stroke', 'disabled'],
});
export const MdxButton = inlineWrapperNode({
  name: 'mdxButton',
  tag: 'Button',
  className: 'pl-button',
  attrs: stringAttrs('href', 'variant'),
  attrKeys: ['href', 'variant'],
});
