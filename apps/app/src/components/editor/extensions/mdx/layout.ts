import { containerNode, inlineWrapperNode, stringAttr, stringAttrs } from './factories';

// ─── Layout and inline UI ────────────────────────────────────────────────────
export const Columns = containerNode({ name: 'mdxColumns', tag: 'Columns', content: 'mdxColumn+', className: 'pl-columns' });
export const Column = containerNode({ name: 'mdxColumn', tag: 'Column', content: 'block+', className: 'pl-column' });
export const Banner = containerNode({
  name: 'mdxBanner',
  tag: 'Banner',
  content: 'block+',
  className: 'pl-banner',
  attrs: stringAttrs('type', 'dismissible'),
});
export const Badge = inlineWrapperNode({ name: 'mdxBadge', tag: 'Badge', className: 'pl-badge', attrs: stringAttr('color') });
export const MdxButton = inlineWrapperNode({
  name: 'mdxButton',
  tag: 'Button',
  className: 'pl-button',
  attrs: stringAttrs('href', 'variant'),
});
