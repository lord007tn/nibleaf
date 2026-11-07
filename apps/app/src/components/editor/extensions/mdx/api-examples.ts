import { stringAttr, titledNode } from './factories';

// ─── API examples ───────────────────────────────────────────────────────────
export const ApiExample = titledNode({
  name: 'mdxApiExample',
  tag: 'ApiExample',
  className: 'pl-apiexample',
  attrs: stringAttr('title'),
  attrKeys: ['title'],
});
export const RequestExample = titledNode({
  name: 'mdxRequestExample',
  tag: 'RequestExample',
  className: 'pl-requestexample',
  attrs: stringAttr('title'),
  attrKeys: ['title'],
});
export const ResponseExample = titledNode({
  name: 'mdxResponseExample',
  tag: 'ResponseExample',
  className: 'pl-responseexample',
  attrs: { ...stringAttr('title'), ...stringAttr('status') },
  attrKeys: ['title', 'status'],
});
