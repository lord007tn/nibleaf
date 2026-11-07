import { boolAttr, containerNode, stringAttrs, titledNode } from './factories';

// ─── Accordions ─────────────────────────────────────────────────────────────
export const AccordionGroup = containerNode({
  name: 'mdxAccordionGroup',
  tag: 'AccordionGroup',
  content: 'mdxAccordion+',
  className: 'pl-accordiongroup',
});
export const Accordion = titledNode({
  name: 'mdxAccordion',
  tag: 'Accordion',
  className: 'pl-accordion',
  attrs: { ...stringAttrs('title', 'description', 'icon', 'id'), ...boolAttr('defaultOpen') },
  attrKeys: ['title', 'defaultOpen', 'description', 'icon', 'id'],
});
