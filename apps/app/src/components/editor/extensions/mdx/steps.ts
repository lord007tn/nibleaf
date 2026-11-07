import { containerNode, stringAttr, titledNode } from './factories';

// ─── Steps ──────────────────────────────────────────────────────────────────
export const Steps = containerNode({ name: 'mdxSteps', tag: 'Steps', content: 'mdxStep+', className: 'pl-steps' });
export const Step = titledNode({ name: 'mdxStep', tag: 'Step', className: 'pl-step', attrs: stringAttr('title'), attrKeys: ['title'] });
