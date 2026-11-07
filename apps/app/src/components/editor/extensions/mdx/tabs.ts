import { containerNode, stringAttr, titledNode } from './factories';

// ─── Tabs ───────────────────────────────────────────────────────────────────
export const Tabs = containerNode({ name: 'mdxTabs', tag: 'Tabs', content: 'mdxTab+', className: 'pl-tabs' });
export const Tab = titledNode({ name: 'mdxTab', tag: 'Tab', className: 'pl-tab', attrs: stringAttr('title') });
