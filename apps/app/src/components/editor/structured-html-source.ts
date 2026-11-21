import { type DOMOutputSpec, DOMParser, DOMSerializer, type Mark, type Node as PMNode } from '@tiptap/pm/model';
import type { MarkdownSerializerState } from 'prosemirror-markdown';
import { allowedURL, escapeImageAttribute } from './extensions/html-safety';

export const STRUCTURED_SOURCE_ATTRIBUTE = 'data-nibleaf-structured-source';

export const STRUCTURED_BLOCK_NODES: Readonly<Record<string, string>> = {
  p: 'paragraph',
  h1: 'heading',
  h2: 'heading',
  h3: 'heading',
  h4: 'heading',
  h5: 'heading',
  h6: 'heading',
  ol: 'orderedList',
  ul: 'bulletList',
  li: 'listItem',
  blockquote: 'blockquote',
  pre: 'codeBlock',
};

export interface StructuredHtmlSource {
  open: string;
  close: string;
  inner?: string;
  href?: string;
  hrefRange?: [number, number];
  listStart?: number;
  listStartRange?: [number, number];
}

const htmlDocument = () => document.implementation.createHTMLDocument('');

const cachedBodies = new WeakMap<object, string | null>();

export function safeStructuredAttribute(name: string, value: string | boolean): boolean {
  if (/^(?:on.*|srcdoc|formaction|srcset|dangerouslysetinnerhtml|xmlns(?::.*)?|xlink:href)$/i.test(name)) return false;
  return !/^(?:href|src|poster)$/i.test(name) || (typeof value === 'string' && allowedURL(value, ['http', 'https', 'mailto', 'tel']));
}

function canonicalBody(node: PMNode, doc: Document, serializer: DOMSerializer): string {
  const element = serializer.serializeNode(node, { document: doc });
  return element.nodeType === 1 ? (element as Element).innerHTML : (element.textContent ?? '');
}

function originalBody(node: PMNode, source: StructuredHtmlSource, doc: Document, serializer: DOMSerializer): string | null {
  if (source.inner === undefined) return null;
  let canonical = cachedBodies.get(node.attrs);
  if (canonical !== undefined) return canonical;
  const container = doc.createElement('div');
  container.innerHTML = source.open + source.inner + source.close;
  // An unchanged native node must not revive an attribute the DOM parser dropped.
  if (
    [...container.querySelectorAll('*')].some((element) => [...element.attributes].some(({ name, value }) => !safeStructuredAttribute(name, value)))
  ) {
    cachedBodies.set(node.attrs, null);
    return null;
  }
  const original = DOMParser.fromSchema(node.type.schema).parse(container).firstChild;
  canonical = original?.type === node.type ? canonicalBody(original, doc, serializer) : null;
  cachedBodies.set(node.attrs, canonical);
  return canonical;
}

const sourceTag = (source: StructuredHtmlSource): string => /^<([a-z][a-z0-9]*)[\s>]/.exec(source.open)?.[1] ?? '';

function replaceAttribute(open: string, name: string, range: [number, number] | undefined, value: string): string {
  const rendered = `${name}="${escapeImageAttribute(value)}"`;
  if (!range) return open.replace(/>$/, ` ${rendered}>`);
  const [start, end] = range;
  const gap = /^[\s/>]/.test(open[end] ?? '>') ? '' : ' ';
  return `${open.slice(0, start)}${rendered}${gap}${open.slice(end)}`;
}

// The rich editor's DOM omits source metadata. Within an HTML block we still need
// the authored attributes of any structured child when the parent body was edited.
function withStructuredChildren(serializer: DOMSerializer, doc: Document): DOMSerializer {
  const restore = (spec: DOMOutputSpec, source?: StructuredHtmlSource): DOMOutputSpec => {
    if (!source || !Array.isArray(spec)) return spec;
    const parsed = doc.createElement('div');
    parsed.innerHTML = source.open + source.close;
    const element = parsed.firstElementChild;
    if (!element) return spec;
    const [tag, first, ...rest] = spec;
    const hasAttributes = first !== null && typeof first === 'object' && !Array.isArray(first) && !('nodeType' in first);
    const attrs = Object.fromEntries(Array.from(element.attributes, ({ name, value }) => [name, value]));
    if (hasAttributes) {
      for (const [key, value] of Object.entries(first)) if (value != null) attrs[key] = String(value);
    }
    return [tag, attrs, ...(hasAttributes ? rest : [first, ...rest])];
  };
  const nodes = { ...serializer.nodes };
  for (const name of new Set(Object.values(STRUCTURED_BLOCK_NODES))) {
    const draw = nodes[name];
    if (draw) nodes[name] = (node) => restore(draw(node), node.attrs.sourceStructuredHtml);
  }
  const marks = { ...serializer.marks };
  const link = marks.link;
  if (link) marks.link = (mark, inline) => restore(link(mark, inline), mark.attrs.sourceStructuredHtml);
  return new DOMSerializer(nodes, marks);
}

export function writeStructuredHtmlBlock(state: MarkdownSerializerState, node: PMNode): boolean {
  const source = node.attrs.sourceStructuredHtml as StructuredHtmlSource | undefined;
  // A Markdown list already emits its own item marker. The HTML list writer
  // restores attributed items through withStructuredChildren instead.
  if (!source || node.type.name === 'listItem' || STRUCTURED_BLOCK_NODES[sourceTag(source)] !== node.type.name) return false;
  const doc = htmlDocument();
  const serializer = DOMSerializer.fromSchema(node.type.schema);
  const canonical = canonicalBody(node, doc, serializer);
  const original = originalBody(node, source, doc, serializer);
  const unchanged = original !== null && canonical === original;
  const tag = sourceTag(source);
  const outputTag = node.type.name === 'heading' ? `h${node.attrs.level}` : tag;
  let open = outputTag === tag ? source.open : source.open.replace(`<${tag}`, `<${outputTag}`);
  if (tag === 'ol' && Number.isInteger(node.attrs.start) && node.attrs.start !== source.listStart) {
    open = replaceAttribute(open, 'start', source.listStartRange, String(node.attrs.start));
  }
  const close = outputTag === tag ? source.close : source.close.replace(`</${tag}`, `</${outputTag}`);
  const content = unchanged ? (source.inner ?? '') : canonicalBody(node, doc, withStructuredChildren(serializer, doc));
  state.text(open + content + close, false);
  state.closeBlock(node);
  return true;
}

export function structuredLinkSource(mark: Mark): StructuredHtmlSource | undefined {
  const source = mark.attrs.sourceStructuredHtml as StructuredHtmlSource | undefined;
  const href: unknown = mark.attrs.href;
  if (!source || sourceTag(source) !== 'a' || typeof href !== 'string' || !allowedURL(href, ['http', 'https', 'mailto', 'tel'])) return undefined;
  if (href === source.href) return source;
  const [start, end] = source.hrefRange ?? [];
  if (start === undefined || end === undefined || !/^href[\s=]/i.test(source.open.slice(start, end))) return undefined;
  const originalName = /^href/i.exec(source.open.slice(start, end))?.[0] ?? 'href';
  return { ...source, open: replaceAttribute(source.open, originalName, [start, end], href) };
}
