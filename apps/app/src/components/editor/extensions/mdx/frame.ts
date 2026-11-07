import { stringAttr, titledNode } from './factories';

// ─── Frame ──────────────────────────────────────────────────────────────────
export const Frame = titledNode({ name: 'mdxFrame', tag: 'Frame', className: 'pl-frame', attrs: stringAttr('caption'), attrKeys: ['caption'] });
