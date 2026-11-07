import { containerNode, numberAttr, stringAttr, stringAttrs, titledNode } from './factories';

// ─── Steps ──────────────────────────────────────────────────────────────────
export const Steps = containerNode({
  name: 'mdxSteps',
  tag: 'Steps',
  content: 'mdxStep+',
  className: 'pl-steps',
  attrs: stringAttr('titleSize'),
  attrKeys: ['titleSize'],
});
export const Step = titledNode({
  name: 'mdxStep',
  tag: 'Step',
  className: 'pl-step',
  attrs: { ...stringAttrs('title', 'icon', 'titleSize'), ...numberAttr('stepNumber') },
  attrKeys: ['title', 'icon', 'stepNumber', 'titleSize'],
});
