import { containerNode, stringAttr } from './factories';

// ─── Update (changelog entry) ─────────────────────────────────────────────────
export const Update = containerNode({
  name: 'mdxUpdate',
  tag: 'Update',
  content: 'block+',
  className: 'pl-update',
  attrs: { ...stringAttr('label'), ...stringAttr('description') },
  attrKeys: ['label', 'description'],
});
