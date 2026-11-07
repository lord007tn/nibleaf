import { stringAttrs, titledNode } from './factories';

// ─── Frame ──────────────────────────────────────────────────────────────────
export const Frame = titledNode({
  name: 'mdxFrame',
  tag: 'Frame',
  className: 'pl-frame',
  attrs: stringAttrs('caption', 'hint'),
  attrKeys: ['caption', 'hint'],
});
