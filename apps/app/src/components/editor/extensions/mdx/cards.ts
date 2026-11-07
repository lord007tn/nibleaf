import { containerNode, stringAttr, titledNode } from './factories';

// ─── Cards ──────────────────────────────────────────────────────────────────
export const CardGroup = containerNode({
  name: 'mdxCardGroup',
  tag: 'CardGroup',
  content: 'mdxCard+',
  className: 'pl-cardgroup',
  attrs: {
    cols: {
      default: '2',
      parseHTML: (el) => el.getAttribute('cols') ?? el.getAttribute('data-cols') ?? '2',
      renderHTML: (a) => ({ 'data-cols': String(a.cols ?? '2') }),
    },
  },
  attrKeys: ['cols'],
});
export const Card = titledNode({
  name: 'mdxCard',
  tag: 'Card',
  className: 'pl-card',
  attrs: { ...stringAttr('title'), ...stringAttr('icon'), ...stringAttr('href') },
  attrKeys: ['title', 'icon', 'href'],
});
