import { translateFn } from '@nibleaf/i18n';
import { mergeAttributes, Node } from '@tiptap/core';
import type { DOMOutputSpec, Node as PMNode } from '@tiptap/pm/model';
import type { MarkdownNodeSpec } from 'tiptap-markdown';

type SerializeState = {
  write: (text: string) => void;
  closeBlock: (node: PMNode) => void;
};

type SupportedDefinition = {
  canonical: string;
  attrs: string[];
  defaults?: Record<string, string | boolean>;
  inline?: boolean;
  calloutVariant?: string;
};

/** The single capability inventory used by the source adapter and safety UX. */
const SUPPORTED_MDX_COMPONENTS: Readonly<Record<string, SupportedDefinition>> = {
  steps: { canonical: 'Steps', attrs: [] },
  step: { canonical: 'Step', attrs: ['title'], defaults: { title: '' } },
  cardgroup: { canonical: 'CardGroup', attrs: ['cols'], defaults: { cols: '2' } },
  card: { canonical: 'Card', attrs: ['title', 'icon', 'href'], defaults: { title: '', icon: '', href: '' } },
  tabs: { canonical: 'Tabs', attrs: [] },
  tab: { canonical: 'Tab', attrs: ['title'], defaults: { title: '' } },
  accordiongroup: { canonical: 'AccordionGroup', attrs: [] },
  accordion: {
    canonical: 'Accordion',
    attrs: ['title', 'defaultOpen'],
    defaults: { title: '', defaultOpen: false },
  },
  frame: { canonical: 'Frame', attrs: ['caption'], defaults: { caption: '' } },
  expandable: {
    canonical: 'Expandable',
    attrs: ['title', 'defaultOpen'],
    defaults: { title: '', defaultOpen: false },
  },
  update: {
    canonical: 'Update',
    attrs: ['label', 'description'],
    defaults: { label: '', description: '' },
  },
  filetree: { canonical: 'FileTree', attrs: [] },
  folder: {
    canonical: 'Folder',
    attrs: ['name', 'defaultOpen'],
    defaults: { name: '', defaultOpen: false },
  },
  file: { canonical: 'File', attrs: ['name', 'icon'], defaults: { name: '', icon: '' } },
  apiexample: { canonical: 'ApiExample', attrs: ['title'], defaults: { title: '' } },
  requestexample: { canonical: 'RequestExample', attrs: ['title'], defaults: { title: '' } },
  responseexample: {
    canonical: 'ResponseExample',
    attrs: ['title', 'status'],
    defaults: { title: '', status: '' },
  },
  relatedcontent: { canonical: 'RelatedContent', attrs: ['title'], defaults: { title: '' } },
  relatedcard: {
    canonical: 'RelatedCard',
    attrs: ['title', 'description', 'href', 'icon'],
    defaults: { title: '', description: '', href: '', icon: '' },
  },
  paramfield: {
    canonical: 'ParamField',
    attrs: ['path', 'query', 'header', 'body', 'name', 'type', 'required', 'default', 'deprecated'],
  },
  responsefield: { canonical: 'ResponseField', attrs: ['name', 'type', 'required', 'default', 'deprecated'] },
  codegroup: { canonical: 'CodeGroup', attrs: [] },
  columns: { canonical: 'Columns', attrs: [] },
  column: { canonical: 'Column', attrs: [] },
  banner: { canonical: 'Banner', attrs: ['type', 'dismissible'] },
  badge: { canonical: 'Badge', attrs: ['color'], defaults: { color: '' }, inline: true },
  button: { canonical: 'Button', attrs: ['href', 'variant'], defaults: { href: '', variant: '' }, inline: true },
  tooltip: { canonical: 'Tooltip', attrs: ['tip'], defaults: { tip: '' }, inline: true },
  icon: {
    canonical: 'Icon',
    attrs: ['icon', 'name', 'color', 'size'],
    defaults: { icon: '', name: '', color: '', size: '' },
    inline: true,
  },
  callout: { canonical: 'Callout', attrs: ['type'], calloutVariant: 'note' },
  note: { canonical: 'Note', attrs: [], calloutVariant: 'note' },
  tip: { canonical: 'Tip', attrs: [], calloutVariant: 'tip' },
  check: { canonical: 'Check', attrs: [], calloutVariant: 'check' },
  warning: { canonical: 'Warning', attrs: [], calloutVariant: 'warning' },
  danger: { canonical: 'Danger', attrs: [], calloutVariant: 'danger' },
  info: { canonical: 'Info', attrs: [], calloutVariant: 'info' },
};

interface TagToken {
  start: number;
  end: number;
  name: string;
  raw: string;
  closing: boolean;
  selfClosing: boolean;
}

interface SourceRange {
  start: number;
  end: number;
  source: string;
  name: string;
  block: boolean;
}

interface AttributeToken {
  name: string;
  start: number;
  end: number;
  value: string | boolean;
}

export const encodeMdxSource = (value: string): string => encodeURIComponent(value);

export const decodeMdxSource = (value: string | null | undefined): string => {
  if (!value) return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const escapeHtmlAttribute = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const lineIsFence = (line: string): { marker: string; length: number } | null => {
  const match = /^\s*(`{3,}|~{3,})/.exec(line);
  return match?.[1] ? { marker: match[1][0] ?? '`', length: match[1].length } : null;
};

/** True for positions in fenced or inline code, where JSX-looking text is literal. */
function codeMask(source: string): Uint8Array {
  const mask = new Uint8Array(source.length);
  let offset = 0;
  let fence: { marker: string; length: number } | null = null;
  for (const lineWithBreak of source.match(/.*(?:\n|$)/g) ?? []) {
    if (!lineWithBreak) continue;
    const line = lineWithBreak.endsWith('\n') ? lineWithBreak.slice(0, -1) : lineWithBreak;
    const candidate = lineIsFence(line);
    if (fence || candidate) {
      mask.fill(1, offset, offset + lineWithBreak.length);
      if (!fence && candidate) fence = candidate;
      else if (fence && candidate?.marker === fence.marker && candidate.length >= fence.length) fence = null;
    } else {
      let cursor = 0;
      while (cursor < line.length) {
        if (line[cursor] !== '`') {
          cursor++;
          continue;
        }
        let count = 1;
        while (line[cursor + count] === '`') count++;
        const closer = line.indexOf('`'.repeat(count), cursor + count);
        if (closer < 0) break;
        mask.fill(1, offset + cursor, offset + closer + count);
        cursor = closer + count;
      }
    }
    offset += lineWithBreak.length;
  }
  return mask;
}

function balancedEnd(source: string, start: number, open: string, close: string): number | null {
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let i = start; i < source.length; i++) {
    const char = source[i] ?? '';
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === open) depth++;
    else if (char === close) {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return null;
}

function scanTags(source: string, mask = codeMask(source)): TagToken[] {
  const tokens: TagToken[] = [];
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== '<' || mask[i]) continue;
    let cursor = i + 1;
    const closing = source[cursor] === '/';
    if (closing) cursor++;
    const nameMatch = /^[A-Z][A-Za-z0-9_.:-]*/.exec(source.slice(cursor));
    if (!nameMatch?.[0]) continue;
    const name = nameMatch[0];
    cursor += name.length;
    if (!/[\s/>]/.test(source[cursor] ?? '')) continue;
    let quote = '';
    let braces = 0;
    let escaped = false;
    for (; cursor < source.length; cursor++) {
      const char = source[cursor] ?? '';
      if (quote) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === quote) quote = '';
        continue;
      }
      if (char === '"' || char === "'" || char === '`') quote = char;
      else if (char === '{') braces++;
      else if (char === '}') braces = Math.max(0, braces - 1);
      else if (char === '>' && braces === 0) break;
    }
    if (source[cursor] !== '>') continue;
    const raw = source.slice(i, cursor + 1);
    tokens.push({ start: i, end: cursor + 1, name, raw, closing, selfClosing: !closing && /\/\s*>$/.test(raw) });
    i = cursor;
  }
  return tokens;
}

function tagPairs(tokens: TagToken[]): Map<number, number> {
  const pairs = new Map<number, number>();
  const stack: number[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token) continue;
    if (!token.closing && !token.selfClosing) {
      stack.push(i);
      continue;
    }
    if (!token.closing) continue;
    for (let s = stack.length - 1; s >= 0; s--) {
      const openIndex = stack[s];
      const open = openIndex == null ? undefined : tokens[openIndex];
      if (open?.name === token.name) {
        pairs.set(openIndex as number, i);
        stack.splice(s, 1);
        break;
      }
    }
  }
  return pairs;
}

const isWholeLine = (source: string, start: number, end: number): boolean => {
  const lineStart = source.lastIndexOf('\n', start - 1) + 1;
  const nextNewline = source.indexOf('\n', end);
  const lineEnd = nextNewline < 0 ? source.length : nextNewline;
  return source.slice(lineStart, start).trim() === '' && source.slice(end, lineEnd).trim() === '';
};

function unsupportedRanges(source: string, tokens: TagToken[], pairs: Map<number, number>): SourceRange[] {
  const ranges: SourceRange[] = [];
  let coveredUntil = -1;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token || token.start < coveredUntil || SUPPORTED_MDX_COMPONENTS[token.name.toLowerCase()]) continue;
    if (token.closing) {
      ranges.push({ start: token.start, end: token.end, source: token.raw, name: token.name, block: isWholeLine(source, token.start, token.end) });
      continue;
    }
    const closeIndex = pairs.get(i);
    const close = closeIndex == null ? undefined : tokens[closeIndex];
    const end = close?.end ?? token.end;
    ranges.push({
      start: token.start,
      end,
      source: source.slice(token.start, end),
      name: token.name,
      block: source.slice(token.start, end).includes('\n') || isWholeLine(source, token.start, end),
    });
    coveredUntil = end;
  }
  return ranges;
}

function parseAttributes(raw: string, componentName: string): AttributeToken[] {
  const attrs: AttributeToken[] = [];
  let cursor = raw.indexOf(componentName) + componentName.length;
  const limit = raw.length - (raw.endsWith('/>') ? 2 : 1);
  while (cursor < limit) {
    while (/\s/.test(raw[cursor] ?? '')) cursor++;
    if (cursor >= limit) break;
    const start = cursor;
    while (cursor < limit && !/[\s=/>]/.test(raw[cursor] ?? '')) cursor++;
    const name = raw.slice(start, cursor);
    if (!name) break;
    while (/\s/.test(raw[cursor] ?? '')) cursor++;
    if (raw[cursor] !== '=') {
      attrs.push({ name, start, end: cursor, value: true });
      continue;
    }
    cursor++;
    while (/\s/.test(raw[cursor] ?? '')) cursor++;
    let value: string;
    const quote = raw[cursor];
    if (quote === '"' || quote === "'") {
      const valueStart = ++cursor;
      while (cursor < limit && raw[cursor] !== quote) cursor += raw[cursor] === '\\' ? 2 : 1;
      value = raw.slice(valueStart, cursor);
      cursor++;
    } else if (quote === '{') {
      const end = balancedEnd(raw, cursor, '{', '}') ?? limit;
      value = raw.slice(cursor, end);
      cursor = end;
    } else {
      const valueStart = cursor;
      while (cursor < limit && !/\s/.test(raw[cursor] ?? '')) cursor++;
      value = raw.slice(valueStart, cursor);
    }
    attrs.push({ name, start, end: cursor, value });
  }
  return attrs;
}

const attributeValue = (attrs: AttributeToken[], name: string): string | boolean | undefined =>
  attrs.find((attr) => attr.name.toLowerCase() === name.toLowerCase())?.value;

function effectiveAttributes(definition: SupportedDefinition, attrs: AttributeToken[]): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};
  for (const name of definition.attrs) {
    result[name] = attributeValue(attrs, name) ?? definition.defaults?.[name] ?? '';
  }
  return result;
}

function placeholder(range: SourceRange): string {
  const tag = range.block ? 'nibleaf-mdx-opaque-block' : 'nibleaf-mdx-opaque-inline';
  return `<${tag} data-source="${encodeMdxSource(range.source)}" data-name="${escapeHtmlAttribute(range.name)}"></${tag}>`;
}

function metadataAttributes(open: TagToken, close: TagToken | undefined, definition: SupportedDefinition): string {
  const attrs = parseAttributes(open.raw, open.name);
  const effective = effectiveAttributes(definition, attrs);
  const known = definition.attrs
    .map((name) => {
      const value = effective[name];
      return value === '' || value === false || value == null ? '' : ` data-${name}="${escapeHtmlAttribute(String(value))}"`;
    })
    .join('');
  return ` data-mdx-source-open="${encodeMdxSource(open.raw)}" data-mdx-source-close="${encodeMdxSource(close?.raw ?? '')}" data-mdx-source-original="${encodeMdxSource(
    JSON.stringify(effective),
  )}"${known}`;
}

/**
 * Converts MDX-only syntax into HTML that markdown-it/DOMParser can safely feed
 * to ProseMirror. Serializers restore the source metadata before persistence.
 */
function prepareMdxForEditor(source: string): string {
  if (!source || (!source.includes('<') && !source.includes('{') && !/^\s*(?:import|export)\s/m.test(source))) return source;
  const mask = codeMask(source);
  const tokens = scanTags(source, mask);
  const pairs = tagPairs(tokens);
  let opaque = unsupportedRanges(source, tokens, pairs);

  // MDX ESM and standalone expressions are also explicit opaque nodes. Braces
  // inside JSX tags were consumed by scanTags and are excluded here.
  const occupied = [...opaque, ...tokens.map((token) => ({ start: token.start, end: token.end }))];
  const overlaps = (start: number, end: number) => occupied.some((range) => start < range.end && end > range.start);
  const containsPosition = (position: number) => occupied.some((range) => position >= range.start && position < range.end);
  let offset = 0;
  for (const lineWithBreak of source.match(/.*(?:\n|$)/g) ?? []) {
    if (!lineWithBreak) continue;
    const line = lineWithBreak.endsWith('\n') ? lineWithBreak.slice(0, -1) : lineWithBreak;
    if (/^\s*(?:import|export)\s/.test(line) && !overlaps(offset, offset + line.length)) {
      const moduleRange = { start: offset, end: offset + line.length, source: line, name: 'MDX module', block: true };
      opaque.push(moduleRange);
      occupied.push(moduleRange);
    }
    offset += lineWithBreak.length;
  }
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== '{' || mask[i] || containsPosition(i)) continue;
    const end = balancedEnd(source, i, '{', '}');
    if (!end) continue;
    // A standalone expression owns any JSX nested inside it. Replace the whole
    // expression once, rather than exposing punctuation around smaller atoms.
    opaque = opaque.filter((range) => !(range.start >= i && range.end <= end));
    opaque.push({ start: i, end, source: source.slice(i, end), name: 'Expression', block: isWholeLine(source, i, end) });
    occupied.push({ start: i, end });
    i = end - 1;
  }

  const replacements: Array<{ start: number; end: number; value: string }> = opaque.map((range) => ({
    start: range.start,
    end: range.end,
    value: placeholder(range),
  }));
  const opaqueCoverage = (start: number) => opaque.some((range) => start >= range.start && start < range.end);
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token || opaqueCoverage(token.start)) continue;
    const definition = SUPPORTED_MDX_COMPONENTS[token.name.toLowerCase()];
    if (!definition) continue;
    if (token.closing) {
      const wrapper = definition.inline ? 'span' : 'div';
      replacements.push({ start: token.start, end: token.end, value: `</${wrapper}>` });
      continue;
    }
    const closeIndex = pairs.get(i);
    const close = closeIndex == null ? undefined : tokens[closeIndex];
    const wrapper = definition.inline ? 'span' : 'div';
    const marker = definition.calloutVariant
      ? ` data-callout="" data-variant="${escapeHtmlAttribute(
          definition.canonical === 'Callout'
            ? String(attributeValue(parseAttributes(token.raw, token.name), 'type') ?? definition.calloutVariant)
            : definition.calloutVariant,
        )}"`
      : ` data-mdx="${definition.canonical}"`;
    const open = `<${wrapper}${marker}${metadataAttributes(token, close, definition)}>`;
    replacements.push({ start: token.start, end: token.end, value: token.selfClosing ? `${open}</${wrapper}>` : open });
  }

  replacements.sort((a, b) => b.start - a.start || b.end - a.end);
  let output = source;
  let lastStart = source.length + 1;
  for (const replacement of replacements) {
    if (replacement.end > lastStart) continue;
    output = `${output.slice(0, replacement.start)}${replacement.value}${output.slice(replacement.end)}`;
    lastStart = replacement.start;
  }
  return output;
}

/** Inventory unknown tags without treating them as a page-wide failure. */
export function findUnsupportedMdxComponents(source: string): string[] {
  const tokens = scanTags(source);
  const result: string[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    const lower = token.name.toLowerCase();
    if (!SUPPORTED_MDX_COMPONENTS[lower] && !seen.has(lower)) {
      seen.add(lower);
      result.push(token.name);
    }
  }
  return result;
}

export function sourceMetadataAttributes() {
  return {
    sourceOpen: {
      default: '',
      parseHTML: (element: HTMLElement) => decodeMdxSource(element.getAttribute('data-mdx-source-open')),
      rendered: false,
    },
    sourceClose: {
      default: '',
      parseHTML: (element: HTMLElement) => decodeMdxSource(element.getAttribute('data-mdx-source-close')),
      rendered: false,
    },
    sourceOriginal: {
      default: '',
      parseHTML: (element: HTMLElement) => decodeMdxSource(element.getAttribute('data-mdx-source-original')),
      rendered: false,
    },
  };
}

const equalSourceValue = (left: unknown, right: unknown): boolean => String(left ?? '') === String(right ?? '');

function replaceOpeningAttribute(raw: string, componentName: string, name: string, value: unknown): string {
  const attrs = parseAttributes(raw, componentName);
  const existing = attrs.find((attr) => attr.name.toLowerCase() === name.toLowerCase());
  const remove = value == null || value === '' || value === false;
  if (existing) {
    if (remove) return `${raw.slice(0, existing.start)}${raw.slice(existing.end)}`;
    const rendered = value === true ? existing.name : `${existing.name}="${String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`;
    return `${raw.slice(0, existing.start)}${rendered}${raw.slice(existing.end)}`;
  }
  if (remove) return raw;
  const insertAt = raw.search(/\/?>\s*$/);
  const rendered = value === true ? name : `${name}="${String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`;
  return insertAt < 0 ? raw : `${raw.slice(0, insertAt)} ${rendered}${raw.slice(insertAt)}`;
}

/** Reuse an author's exact opener until a visually editable prop changes. */
export function preservedOpeningTag(node: PMNode, canonical: string, attrKeys: string[], selfClosing = false): string {
  const raw = String(node.attrs.sourceOpen ?? '');
  if (!raw) {
    const attrs = attrKeys
      .map((key) => {
        const value = node.attrs[key];
        if (value == null || value === '' || value === false) return '';
        return value === true ? ` ${key}` : ` ${key}="${String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`;
      })
      .join('');
    return `<${canonical}${attrs}${selfClosing ? ' /' : ''}>`;
  }
  let original: Record<string, unknown> = {};
  try {
    original = JSON.parse(String(node.attrs.sourceOriginal ?? '')) as Record<string, unknown>;
  } catch {
    return raw;
  }
  if (attrKeys.every((key) => equalSourceValue(node.attrs[key], original[key]))) return raw;
  const sourceName = /^<([A-Za-z][\w.:-]*)/.exec(raw)?.[1] ?? canonical;
  return attrKeys.reduce(
    (opening, key) =>
      equalSourceValue(node.attrs[key], original[key]) ? opening : replaceOpeningAttribute(opening, sourceName, key, node.attrs[key]),
    raw,
  );
}

export const preservedClosingTag = (node: PMNode, canonical: string): string => String(node.attrs.sourceClose ?? '') || `</${canonical}>`;

function opaqueAttributes() {
  return {
    source: {
      default: '',
      parseHTML: (element: HTMLElement) => decodeMdxSource(element.getAttribute('data-source')),
      rendered: false,
    },
    name: { default: 'MDX', parseHTML: (element: HTMLElement) => element.getAttribute('data-name') ?? 'MDX', rendered: false },
  };
}

const opaqueHtml = (node: PMNode, inline: boolean): DOMOutputSpec => {
  const source = String(node.attrs.source ?? '');
  const name = String(node.attrs.name ?? 'MDX');
  const tag = inline ? 'span' : 'div';
  return [
    tag,
    mergeAttributes({
      class: inline ? 'pl-mdx-opaque-inline' : 'pl-mdx-opaque-block',
      'data-mdx-opaque': inline ? 'inline' : 'block',
      'data-name': name,
      title: translateFn('editor.opaqueMdx.tooltip', { name }),
      contenteditable: 'false',
    }),
    source.length > 180 ? `${source.slice(0, 177)}…` : source,
  ];
};

const installedMarkdownParsers = new WeakSet<object>();

const MdxOpaqueBlock = Node.create({
  name: 'mdxOpaqueBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes: opaqueAttributes,
  parseHTML: () => [{ tag: 'nibleaf-mdx-opaque-block' }],
  renderHTML: ({ node }) => opaqueHtml(node, false),
  addStorage: () => ({
    markdown: {
      serialize(state: SerializeState, node: PMNode) {
        state.write(String(node.attrs.source ?? ''));
        state.closeBlock(node);
      },
      parse: {
        setup(markdownit) {
          if (installedMarkdownParsers.has(markdownit)) return;
          markdownit.core.ruler.before('normalize', 'nibleaf_mdx_source_roundtrip', (state) => {
            state.src = prepareMdxForEditor(state.src);
          });
          installedMarkdownParsers.add(markdownit);
        },
      },
    } satisfies MarkdownNodeSpec,
  }),
});

const MdxOpaqueInline = Node.create({
  name: 'mdxOpaqueInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: opaqueAttributes,
  parseHTML: () => [{ tag: 'nibleaf-mdx-opaque-inline' }],
  renderHTML: ({ node }) => opaqueHtml(node, true),
  addStorage: () => ({
    markdown: {
      serialize(state: SerializeState, node: PMNode) {
        state.write(String(node.attrs.source ?? ''));
      },
      parse: {},
    } satisfies MarkdownNodeSpec,
  }),
});

export const opaqueMdxNodes = [MdxOpaqueBlock, MdxOpaqueInline];
