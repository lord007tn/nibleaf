import type { Root } from 'mdast';
import { defaultSchema } from 'rehype-sanitize';

export type CalloutType = 'note' | 'info' | 'tip' | 'check' | 'warning' | 'danger';

/** Normalize an admonition/callout keyword to one of our supported types. */
export const normalizeType = (raw?: string): CalloutType => {
  const t = (raw ?? 'note').toLowerCase();
  if (t === 'caution' || t === 'error') return 'danger';
  if (t === 'important') return 'info';
  if (['note', 'info', 'tip', 'check', 'warning', 'danger'].includes(t)) return t as CalloutType;
  return 'note';
};

/** The custom component tag names the renderer understands (lowercased, as
 *  rehype-raw emits them). */
export const COMPONENT_TAGS = [
  'callout',
  'note',
  'warning',
  'info',
  'tip',
  'check',
  'danger',
  'card',
  'cardgroup',
  'tabs',
  'tab',
  'accordion',
  'accordiongroup',
  'steps',
  'step',
  'frame',
  'tooltip',
] as const;

/** Sanitize schema: the GitHub-safe default, extended to permit our component
 *  tags and their props, plus className/id passthrough for headings & code
 *  highlighting. Scripts, event handlers, and unknown attributes are still
 *  stripped — this is what makes raw component HTML safe to render. */
export const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), ...COMPONENT_TAGS],
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] ?? []), 'className', 'id'],
    callout: ['type'],
    card: ['title', 'href', 'icon'],
    cardgroup: ['cols'],
    tab: ['title'],
    accordion: ['title', 'defaultOpen', 'defaultopen'],
    step: ['title'],
    frame: ['caption'],
    tooltip: ['tip'],
    code: [...(defaultSchema.attributes?.code ?? []), 'className'],
  },
};

// Minimal mdast walker (avoids adding a unist-util-visit dependency).
type AnyNode = { type: string; value?: string; children?: AnyNode[]; data?: { hName?: string; hProperties?: Record<string, unknown> } };
function walk(node: AnyNode, type: string, fn: (n: AnyNode) => void) {
  if (node.type === type) {
    fn(node);
  }
  for (const child of node.children ?? []) {
    walk(child, type, fn);
  }
}

const ADMONITION = /^\[!(\w+)\]\s*/;

/** remark plugin: rewrite blockquotes that start with `[!TYPE]` into a
 *  `callout` element with a `type` prop, stripping the marker — so the Callout
 *  authored in the editor (serialized as a GitHub admonition) renders as a
 *  styled callout instead of a raw blockquote showing a literal "[!NOTE]". */
export function remarkCallouts() {
  return (tree: Root) => {
    walk(tree as unknown as AnyNode, 'blockquote', (node) => {
      const firstPara = node.children?.[0];
      if (firstPara?.type !== 'paragraph') {
        return;
      }
      const firstText = firstPara.children?.[0];
      if (firstText?.type !== 'text' || firstText.value === undefined) {
        return;
      }
      const match = ADMONITION.exec(firstText.value);
      if (!match) {
        return;
      }
      firstText.value = firstText.value.replace(ADMONITION, '');
      if (firstText.value === '' && firstPara.children?.length === 1) {
        node.children?.shift();
      }
      node.data = node.data ?? {};
      node.data.hName = 'callout';
      node.data.hProperties = { type: normalizeType(match[1]) };
    });
  };
}
