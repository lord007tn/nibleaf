import MarkdownIt from 'markdown-it';
import { type DefaultTreeAdapterTypes, parseFragment } from 'parse5';

const markdown = new MarkdownIt({ html: true });
// Independent of the production policy: scan candidate URLs with sticky token
// patterns and skip entire descriptor parentheses before accepting a comma.
export const exportUrlCandidates = (value: string, name: string, tag = ''): string[] => {
  if (['ping', 'profile', 'itemtype', 'attributionsrc', 'archive'].includes(name))
    return value.split(name === 'archive' && tag === 'applet' ? /[\t\n\f\r ,]+/ : /[\t\n\f\r ]+/);
  if (name !== 'srcset' && name !== 'imagesrcset') return [value];
  const result: string[] = [];
  const separators = /[\t\n\f\r ,]*/y,
    url = /[^\t\n\f\r ]+/y,
    descriptors = /\([^)]*(?:\)|$)|,/g;
  let cursor = 0;
  while (cursor < value.length) {
    separators.lastIndex = cursor;
    separators.exec(value);
    cursor = separators.lastIndex;
    url.lastIndex = cursor;
    const token = url.exec(value);
    if (!token) break;
    cursor = url.lastIndex;
    result.push(token[0].replace(/,+$/, ''));
    if (token[0].endsWith(',')) continue;
    descriptors.lastIndex = cursor;
    let match: RegExpExecArray | null;
    do {
      match = descriptors.exec(value);
    } while (match && match[0] !== ',');
    cursor = match ? descriptors.lastIndex : value.length;
  }
  return result;
};
const urlAttributes = new Set([
  'href',
  'src',
  'xlink:href',
  'action',
  'formaction',
  'data',
  'poster',
  'background',
  'cite',
  'longdesc',
  'usemap',
  'profile',
  'manifest',
  'codebase',
  'classid',
  'archive',
  'ping',
  'srcset',
  'imagesrcset',
  'icon',
  'lowsrc',
  'dynsrc',
  'itemid',
  'itemtype',
  'attributionsrc',
]);
export const oracleUnsafeAttribute = (name: string, value: string, tag = ''): boolean =>
  name.startsWith('on') ||
  (urlAttributes.has(name) &&
    exportUrlCandidates(value, name, tag).some((candidate) => /^(javascript|vbscript|data):/i.test(candidate.replace(/[\x00-\x20\x7f]/g, ''))));
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
        const name = attribute.prefix ? `${attribute.prefix}:${attribute.name}` : attribute.name;
        if (oracleUnsafeAttribute(name, attribute.value, node.tagName)) features.push(`${node.tagName}:${attribute.name}:${attribute.value}`);
      }
    }
    if ('childNodes' in node)
      for (let at = node.childNodes.length - 1; at >= 0; at--) {
        const child = node.childNodes[at];
        if (child) pending.push(child);
      }
  }
  return { features, elements, active: elements + features.length, text: text.join('') };
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
