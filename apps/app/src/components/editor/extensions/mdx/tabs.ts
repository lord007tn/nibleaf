import { boolAttr, containerNode, numberAttr, stringAttrs, titledNode } from './factories';

// ─── Tabs ───────────────────────────────────────────────────────────────────
export const Tabs = containerNode({
  name: 'mdxTabs',
  tag: 'Tabs',
  content: 'mdxTab+',
  className: 'pl-tabs',
  attrs: { ...numberAttr('defaultTabIndex'), ...boolAttr('sync', true), ...boolAttr('borderBottom') },
  attrKeys: ['defaultTabIndex', 'sync', 'borderBottom'],
});
export const Tab = titledNode({
  name: 'mdxTab',
  tag: 'Tab',
  className: 'pl-tab',
  attrs: stringAttrs('title', 'icon', 'id'),
  attrKeys: ['title', 'icon', 'id'],
});
