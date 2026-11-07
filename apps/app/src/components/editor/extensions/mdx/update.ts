import { containerNode } from './factories';

// ─── Update (changelog entry) ─────────────────────────────────────────────────
export const Update = containerNode({
  name: 'mdxUpdate',
  tag: 'Update',
  content: 'block+',
  className: 'pl-update',
});
