import { boolAttr, containerNode } from './factories';

// ─── CodeGroup (tabbed code blocks) ───────────────────────────────────────────
export const CodeGroup = containerNode({
  name: 'mdxCodeGroup',
  tag: 'CodeGroup',
  content: 'block+',
  className: 'pl-codegroup',
  attrs: boolAttr('dropdown'),
  attrKeys: ['dropdown'],
});
