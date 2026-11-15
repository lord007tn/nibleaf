import MarkdownIt from 'markdown-it';
import { type DefaultTreeAdapterTypes, parseFragment } from 'parse5';

const markdown = new MarkdownIt({ html: true });
export const inspectRenderedExport = (html: string) => {
  const pending: DefaultTreeAdapterTypes.Node[] = [parseFragment(html)];
  const features: string[] = [],
    text: string[] = [];
  let elements = 0;
  while (pending.length) {
    const node = pending.pop();
    if (!node) continue;
    if (node.nodeName === '#text' && 'value' in node) text.push(node.value);
    if ('tagName' in node) {
      if (['script', 'style', 'iframe', 'object', 'embed'].includes(node.tagName)) elements++;
      for (const attribute of node.attrs) {
        const value = Array.from(attribute.value.toLowerCase())
          .filter((c) => c.charCodeAt(0) > 32 && c.charCodeAt(0) !== 127)
          .join('');
        if (
          attribute.name.startsWith('on') ||
          (['href', 'src', 'xlink:href', 'action', 'formaction', 'data', 'poster', 'background'].includes(attribute.name) &&
            ['javascript:', 'vbscript:', 'data:'].some((scheme) => value.startsWith(scheme)))
        )
          features.push(`${node.tagName}:${attribute.name}:${attribute.value}`);
      }
    }
    if ('childNodes' in node)
      for (let at = node.childNodes.length - 1; at >= 0; at--) {
        const child = node.childNodes[at];
        if (child) pending.push(child);
      }
  }
  return { features, elements, text: text.join('') };
};
export const inspectExport = (source: string) => {
  const tokens = markdown.parse(source, {});
  return { tokens, ...inspectRenderedExport(markdown.renderer.render(tokens, markdown.options, {})) };
};
export const newlyLiveFeatures = (before: string[], after: string[]): number => {
  const allowed = new Map<string, number>();
  for (const feature of before) allowed.set(feature, (allowed.get(feature) ?? 0) + 1);
  let count = 0;
  for (const feature of after) {
    const remaining = allowed.get(feature) ?? 0;
    if (remaining) allowed.set(feature, remaining - 1);
    else count++;
  }
  return count;
};

// Decode references in authored source, without interpreting source markup.
export const authoredVisibleText = (source: string): string => inspectRenderedExport(source.replaceAll('\0', '\uFFFD').replaceAll('<', '&#60;')).text;
