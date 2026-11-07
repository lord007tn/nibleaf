import { containerNode, titledNode } from './factories';

// ─── Cards ──────────────────────────────────────────────────────────────────
export const CardGroup = containerNode({
  name: 'mdxCardGroup',
  tag: 'CardGroup',
  content: 'mdxCard+',
  className: 'pl-cardgroup',
});
export const Card = titledNode({
  name: 'mdxCard',
  tag: 'Card',
  className: 'pl-card',
});
