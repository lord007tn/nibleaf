import { stringAttr, stringAttrs, titledNode } from './factories';

// ─── Related content ────────────────────────────────────────────────────────
export const RelatedContent = titledNode({
  name: 'mdxRelatedContent',
  tag: 'RelatedContent',
  className: 'pl-relatedcontent',
  attrs: stringAttr('title'),
});
export const RelatedCard = titledNode({
  name: 'mdxRelatedCard',
  tag: 'RelatedCard',
  className: 'pl-relatedcard',
  attrs: stringAttrs('title', 'description', 'href', 'icon'),
});
