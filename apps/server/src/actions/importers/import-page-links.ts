import { documentationComponentContractEntries, documentationReaderTag } from '@nibleaf/shared/documentation-component-contract';
import { fromMarkdown, type Handle } from 'mdast-util-from-markdown';
import { decodeImportEntities } from './import-fidelity';
import { readImportComponentTag } from './import-markdown-code';
import type { ImportReference } from './import-references';

interface PageReference extends ImportReference {
  kind: 'link' | 'definition' | 'href';
}

const linkElements = new Set([
  'a',
  ...documentationComponentContractEntries().flatMap(([tag, component]) =>
    'href' in component.attributes ? [tag.toLowerCase(), documentationReaderTag(tag)] : [],
  ),
]);
const rawTextClosers = new Map([
  ['script', /<\/script\s*>/gi],
  ['style', /<\/style\s*>/gi],
  ['textarea', /<\/textarea\s*>/gi],
  ['title', /<\/title\s*>/gi],
]);

/** Read actual attributes inside a parser-recognized HTML node, never quoted attribute text. */
const htmlHrefs = (content: string, start: number, end: number): PageReference[] => {
  const references: PageReference[] = [];
  const attribute = /\s+([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/y;
  let cursor = start;
  while (cursor < end) {
    const open = content.indexOf('<', cursor);
    if (open < 0 || open >= end) break;
    if (content.startsWith('<!--', open)) {
      const close = content.indexOf('-->', open + 4);
      cursor = close < 0 ? end : close + 3;
      continue;
    }
    const name = /^<([A-Za-z][\w:-]*)/.exec(content.slice(open, open + 128));
    if (!name) {
      cursor = open + 1;
      continue;
    }
    const tag = readImportComponentTag(content, open);
    cursor = Math.max(open + 1, tag.end);
    if (!tag.complete || tag.end > end) continue;
    const element = name[1]?.toLowerCase() ?? '';
    const close = rawTextClosers.get(element);
    if (close) {
      close.lastIndex = tag.end;
      const match = close.exec(content);
      cursor = match && match.index < end ? close.lastIndex : end;
      continue;
    }
    if (!linkElements.has(element)) continue;
    const source = content.slice(open, tag.end);
    attribute.lastIndex = name[0].length;
    for (let match = attribute.exec(source); match; match = attribute.exec(source)) {
      if (match[1]?.toLowerCase() !== 'href' || (match[2] === undefined && match[3] === undefined)) continue;
      const value = match[2] ?? match[3] ?? '';
      const equals = source.indexOf('=', match.index);
      let quote = equals + 1;
      while (/\s/.test(source[quote] ?? '')) quote++;
      const offset = open + quote + 1;
      references.push({ value: decodeImportEntities(value), start: offset, end: offset + value.length, image: false, kind: 'href' });
    }
  }
  return references;
};

/** Parser destination tokens supply exact source spans, including angle URLs and multiline definitions. */
export const importPageLinks = (content: string): PageReference[] => {
  type Node = {
    type: string;
    identifier?: string;
    url?: string;
    position?: { start: { offset?: number }; end: { offset?: number } };
    children?: Node[];
  };
  const captured: Array<{ owner: Node; start: number; end: number }> = [];
  const capture: Handle = function (token) {
    const owner = this.stack.at(-1);
    if (owner) captured.push({ owner, start: token.start.offset, end: token.end.offset });
    // Keep the compiler's normal destination decoding and AST construction.
    this.buffer();
  };
  const tree = fromMarkdown(content, {
    mdastExtensions: [{ enter: { resourceDestinationString: capture, definitionDestinationString: capture } }],
  });
  const images = new Set<string>();
  const links = new Set<Node>();
  const hrefs: PageReference[] = [];
  const pending: Node[] = [tree];
  while (pending.length) {
    const node = pending.pop();
    if (!node) continue;
    if (node.type === 'imageReference' && node.identifier) images.add(node.identifier);
    if (node.type === 'image' || node.type === 'imageReference') continue;
    if (node.type === 'link') links.add(node);
    if (node.type === 'html' && node.position?.start.offset !== undefined && node.position.end.offset !== undefined) {
      for (const href of htmlHrefs(content, node.position.start.offset, node.position.end.offset)) hrefs.push(href);
    }
    if (node.children)
      for (let index = node.children.length - 1; index >= 0; index--) {
        const child = node.children[index];
        if (child) pending.push(child);
      }
  }
  const markdown: PageReference[] = [];
  for (const { owner, start, end } of captured) {
    const definition = owner.type === 'definition';
    if (owner.url === undefined || (!links.has(owner) && !definition) || (definition && owner.identifier && images.has(owner.identifier))) continue;
    markdown.push({ value: content.slice(start, end), start, end, image: false, kind: definition ? 'definition' : 'link' });
  }
  // Both parser streams are in source order. Merge without sorting or rescanning bodies.
  const references: PageReference[] = [];
  let index = 0;
  for (const reference of markdown) {
    while (hrefs[index] && (hrefs[index]?.start ?? 0) < reference.start) {
      const href = hrefs[index++];
      if (href) references.push(href);
    }
    references.push(reference);
  }
  for (; index < hrefs.length; index++) {
    const href = hrefs[index];
    if (href) references.push(href);
  }
  return references;
};
