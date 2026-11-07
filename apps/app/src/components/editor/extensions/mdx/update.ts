import { containerNode, listAttr, stringAttrs } from './factories';

// ─── Update (changelog entry) ─────────────────────────────────────────────────
export const Update = containerNode({
  name: 'mdxUpdate',
  tag: 'Update',
  content: 'block+',
  className: 'pl-update',
  attrs: { ...stringAttrs('label', 'description'), ...listAttr('tags') },
  attrKeys: ['label', 'description', 'tags'],
});
