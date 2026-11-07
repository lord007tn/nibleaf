import { boolAttr, containerNode, listAttr, stringAttr, stringAttrs, titledNode } from './factories';

// ─── API reference: ParamField / ResponseField ────────────────────────────────
// Modeled as block components so they round-trip losslessly (their attributes are
// preserved through serialize/parse). Attributes are edited in the component
// settings panel; the body (description) is fully editable.
export const ParamField = containerNode({
  name: 'mdxParamField',
  tag: 'ParamField',
  content: 'block+',
  className: 'pl-paramfield',
  attrs: {
    ...stringAttrs('path', 'query', 'header', 'body', 'name', 'type', 'default', 'placeholder'),
    ...boolAttr('required'),
    ...boolAttr('deprecated'),
    ...listAttr('pre'),
    ...listAttr('post'),
  },
  attrKeys: ['path', 'query', 'header', 'body', 'name', 'type', 'required', 'default', 'deprecated', 'placeholder', 'pre', 'post'],
});
export const ResponseField = containerNode({
  name: 'mdxResponseField',
  tag: 'ResponseField',
  content: 'block+',
  className: 'pl-responsefield',
  attrs: {
    ...stringAttrs('name', 'type', 'default'),
    ...boolAttr('required'),
    ...boolAttr('deprecated'),
    ...listAttr('pre'),
    ...listAttr('post'),
  },
  attrKeys: ['name', 'type', 'required', 'default', 'deprecated', 'pre', 'post'],
});

// ─── Expandable (collapsible disclosure) ──────────────────────────────────────
export const Expandable = titledNode({
  name: 'mdxExpandable',
  tag: 'Expandable',
  className: 'pl-expandable',
  attrs: { ...stringAttr('title'), ...boolAttr('defaultOpen') },
  attrKeys: ['title', 'defaultOpen'],
});
