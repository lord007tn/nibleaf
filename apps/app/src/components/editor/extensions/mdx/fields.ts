import { boolAttr, containerNode, flagAttr, stringAttr, stringAttrs, titledNode } from './factories';

// ─── API reference: ParamField / ResponseField ────────────────────────────────
// Modeled as block components so they round-trip losslessly (their attributes are
// preserved through serialize/parse). Inline attribute editing is a follow-up; the
// body (description) is fully editable.
export const ParamField = containerNode({
  name: 'mdxParamField',
  tag: 'ParamField',
  content: 'block+',
  className: 'pl-paramfield',
  attrs: {
    ...stringAttrs('path', 'query', 'header', 'body', 'name', 'type'),
    ...flagAttr('required'),
    ...stringAttr('default'),
    ...flagAttr('deprecated'),
  },
});
export const ResponseField = containerNode({
  name: 'mdxResponseField',
  tag: 'ResponseField',
  content: 'block+',
  className: 'pl-responsefield',
  attrs: { ...stringAttrs('name', 'type'), ...flagAttr('required'), ...stringAttr('default'), ...flagAttr('deprecated') },
});

// ─── Expandable (collapsible disclosure) ──────────────────────────────────────
export const Expandable = titledNode({
  name: 'mdxExpandable',
  tag: 'Expandable',
  className: 'pl-expandable',
  attrs: { ...stringAttr('title'), ...boolAttr('defaultOpen') },
});
