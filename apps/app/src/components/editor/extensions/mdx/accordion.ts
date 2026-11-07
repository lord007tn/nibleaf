import { boolAttr, containerNode, stringAttr, titledNode } from './factories';

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
  attrs: { ...stringAttr('title'), ...boolAttr('defaultOpen') },
  attrKeys: ['title', 'defaultOpen'],
});
