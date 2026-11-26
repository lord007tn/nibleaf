import { protectMarkdownCode } from '@nibleaf/shared/markdown-code';
import MarkdownIt, { type Env, type StateBlock, type Token } from 'markdown-it';
import { type CompileContext, type Extension, fromMarkdown } from 'mdast-util-from-markdown';
import { mdxFromMarkdown } from 'mdast-util-mdx';
import { mdxjs } from 'micromark-extension-mdxjs';
import { readImportComponentTag } from './import-markdown-code';
export interface ImportReference {
  value: string;
  start: number;
  end: number;
  image: boolean;
}

const escaped = (source: string, index: number): boolean => {
  let start = index;
  while (source[start - 1] === '\\') start--;
  return (index - start) % 2 === 1;
};

const TITLE_CLOSERS: Record<string, string> = { '"': '"', "'": "'", '(': ')' };

/** Reject a simple unterminated angle destination before retaining its pairs.
 * Stop at brackets, nesting or escapes: those need the ordinary pairing pass.
 * No candidate label can start in the scanned span, so these lookaheads don't
 * overlap, even when the next `>` is far away or absent. */
const invalidAngleEnd = (source: string, open: number): number => {
  let index = open + 1;
  while (/\s/.test(source[index] ?? '')) index++;
  if (source[index] !== '<') return -1;
  for (index++; index < source.length; index++) {
    const char = source[index];
    if (char === ')') return index;
    if (char === '>' || char === '[' || char === ']' || char === '(' || char === '\\') return -1;
  }
  return -1;
};

/** The destination between a link's parentheses, or undefined when they aren't valid link syntax. */
const readDestination = (source: string, open: number, close: number) => {
  let start = open + 1;
  while (start < close && /\s/.test(source[start] ?? '')) start++;
  const bracketed = source[start] === '<';
  if (bracketed) start++;
  let end = start;
  while (end < close && (bracketed ? source[end] !== '>' : !/\s/.test(source[end] ?? ''))) end++;
  if (bracketed && end === close) return;
  const title = source.slice(bracketed ? end + 1 : end, close).trim();
  return !title || (title.length > 1 && title.at(-1) === TITLE_CLOSERS[title[0] ?? '']) ? { start, end } : undefined;
};

export const markdownReferences = (source: string): ImportReference[] => {
  const labels = new Map<number, number>();
  const destinations = new Map<number, number>();
  const brackets: number[] = [];
  const parentheses: number[] = [];
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (character === '\\') {
      index++;
      continue;
    }
    if (character === '[') brackets.push(index);
    else if (character === ']' && brackets.length) {
      const label = brackets.pop() ?? 0;
      const invalidEnd = source[index + 1] === '(' ? invalidAngleEnd(source, index + 1) : -1;
      if (invalidEnd !== -1) index = invalidEnd;
      else labels.set(index, label);
    } else if (character === '(') parentheses.push(index);
    else if (character === ')' && parentheses.length) destinations.set(parentheses.pop() ?? 0, index);
  }
  const references: ImportReference[] = [];
  // Labels are read in closing order, as Markdown does, and each destination only
  // once, so nested or crossed pairs stay linear and references can't overlap.
  let scanned = 0;
  for (const [labelEnd, label] of labels) {
    const end = destinations.get(labelEnd + 1);
    if (end === undefined || labelEnd < scanned) continue;
    scanned = end;
    const image = source[label - 1] === '!' && !escaped(source, label - 1);
    const destination = readDestination(source, labelEnd + 1, end);
    if (!destination) continue;
    // An image description is alt text, so nothing read inside it is a reference.
    while (image && (references.at(-1)?.start ?? -1) > label) references.pop();
    if (destination.end > destination.start) references.push({ value: source.slice(destination.start, destination.end), ...destination, image });
  }
  return references;
};

/** Keep micromark's potentially expensive inline resolution within this bound.
 * On longer pages, Markdown-it locates definition blocks and reads references.
 * Only those individual definition blocks are sent to micromark. */
const MAX_DEFINITION_PARSE_LENGTH = 4096;

interface Definition {
  label: string;
  start: number;
  end: number;
  destination?: ImportReference;
}

interface ReferenceUses {
  links: Set<string>;
  images: Set<string>;
}

const collectDefinitions = (source: string, mdx: boolean) => {
  const destinations = new Map<number, ImportReference>();
  const spans: Extension = {
    exit: {
      definitionDestination(token) {
        const node = this.stack.at(-1);
        const nodeStart = node?.position?.start.offset;
        const from = token.start.offset;
        const to = token.end.offset;
        if (node?.type !== 'definition' || nodeStart === undefined || from === undefined || to === undefined) return;
        const bracketed = source[from] === '<';
        const start = from + Number(bracketed);
        const end = to - Number(bracketed);
        destinations.set(nodeStart, { value: source.slice(start, end), start, end, image: false });
      },
    },
  };
  const tree = fromMarkdown(source, mdx ? { extensions: [mdxjs()], mdastExtensions: [mdxFromMarkdown(), spans] } : { mdastExtensions: [spans] });
  const links = new Set<string>();
  const images = new Set<string>();
  const definitions: Definition[] = [];
  const pending: CompileContext['stack'] = [tree];
  while (pending.length) {
    const node = pending.pop();
    if (!node) break;
    if (node.type === 'linkReference' && !node.identifier.startsWith('^')) links.add(node.identifier);
    if (node.type === 'imageReference') images.add(node.identifier);
    if (node.type === 'definition') {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start !== undefined && end !== undefined) definitions.push({ label: node.identifier, start, end, destination: destinations.get(start) });
    }
    if ('children' in node) {
      for (let index = node.children.length - 1; index >= 0; index--) {
        const child = node.children[index];
        if (child) pending.push(child);
      }
    }
  }
  return { definitions, links, images };
};

/** A definition span covering its title and the destination of its first link use, if eligible. */
interface DefinitionEdit {
  start: number;
  end: number;
  destination?: ImportReference;
}

const definitionEdits = (definitions: Definition[], { links, images }: ReferenceUses): DefinitionEdit[] => {
  const seen = new Set<string>();
  return definitions.map(({ start, end, label, destination }) => {
    const first = !seen.has(label);
    seen.add(label);
    return {
      start,
      end,
      destination: first && destination?.value && !label.startsWith('^') && links.has(label) && !images.has(label) ? destination : undefined,
    };
  });
};

const reader = new MarkdownIt('commonmark', { html: true });
const parseReferenceBlock = reader.block.ruler.getRules('').find((rule) => rule.name === 'reference');

interface ReferenceScanEnv extends Env {
  captureDefinition?: (state: StateBlock, from: number, to: number) => void;
}

if (parseReferenceBlock) {
  reader.block.ruler.at('reference', (state, from, end, silent) => {
    const accepted = parseReferenceBlock(state, from, end, silent);
    if (accepted && !silent) (state.env as ReferenceScanEnv).captureDefinition?.(state, from, state.line);
    return accepted;
  });
}

const COMPONENT_START = /^ {0,3}<\/?[A-Z]/;
const COMPONENT_NAME = /^ {0,3}<(\/?)([A-Z][\w.]*)(?=[ \t/>])/;

/** Match the Markdown blocks inside standalone MDX components while keeping
 * offsets stable. Use CommonMark on mixed or unbalanced component syntax. */
const maskComponentLines = (source: string): string => {
  if (!/<[A-Z]/.test(source)) return source;
  const lines = source.split('\n');
  const components: string[] = [];
  const masked: number[] = [];
  for (const [index, line] of lines.entries()) {
    if (!COMPONENT_START.test(line)) continue;
    const match = COMPONENT_NAME.exec(line);
    if (!match?.[2]) return source;
    const [, closing, name] = match;
    const tag = readImportComponentTag(line, line.indexOf('<'));
    if (!tag.complete || line.slice(tag.end).trim()) return source;
    if (closing && components.pop() !== name) return source;
    if (!closing && !tag.selfClosing) components.push(name);
    masked.push(index);
  }
  if (components.length) return source;
  for (const index of masked) lines[index] = ' '.repeat(lines[index]?.length ?? 0);
  return lines.join('\n');
};

const longPageDefinitionEdits = (source: string): DefinitionEdit[] => {
  const definitions: Definition[] = [];
  const links = new Set<string>();
  const images = new Set<string>();
  const removedCr: number[] = [0];
  let removed = 0;
  const normalized = source.replace(/\r\n|\r|\n/g, (lineBreak) => {
    if (lineBreak === '\r\n') removed++;
    removedCr.push(removed);
    return '\n';
  });
  const captureDefinition: NonNullable<ReferenceScanEnv['captureDefinition']> = (state, from, to) => {
    const parts: string[] = [];
    const offsets: Array<{ relative: number; absolute: number }> = [];
    let length = 0;
    for (let line = from; line < to; line++) {
      const start = (state.bMarks[line] ?? 0) + (state.tShift[line] ?? 0);
      const end = state.eMarks[line] ?? start;
      if (length + end - start > MAX_DEFINITION_PARSE_LENGTH) return;
      offsets.push({ relative: length, absolute: start + (removedCr[line] ?? 0) });
      parts.push(state.src.slice(start, end));
      length += end - start + 1;
    }
    const fragment = parts.join('\n');
    const absolute = (position: number): number => {
      let index = offsets.length - 1;
      while (index > 0 && position < (offsets[index]?.relative ?? 0)) index--;
      const line = offsets[index];
      return line ? position + line.absolute - line.relative : position;
    };
    for (const { label, start, end, destination } of collectDefinitions(fragment, false).definitions) {
      let mappedDestination: ImportReference | undefined;
      if (destination) {
        const from = absolute(destination.start);
        const to = absolute(destination.end);
        mappedDestination = { value: source.slice(from, to), start: from, end: to, image: false };
      }
      definitions.push({
        label: reader.utils.normalizeReference(label),
        start: absolute(start),
        end: absolute(end),
        destination: mappedDestination,
      });
    }
  };
  const blocks: Token[] = [];
  const env: ReferenceScanEnv = { references: Object.create(null), captureDefinition };
  reader.block.parse(maskComponentLines(normalized), reader, env, blocks);
  if (!definitions.length) return [];
  for (const block of blocks) {
    if (block.type !== 'inline' || !block.content.includes('[')) continue;
    const tokens: Token[] = [];
    reader.inline.parse(block.content, reader, env, tokens);
    for (const token of tokens) {
      const label = token.meta?.label;
      if (typeof label !== 'string') continue;
      if (token.type === 'link_open') links.add(label);
      else if (token.type === 'image') images.add(label);
    }
  }
  return definitionEdits(definitions, { links, images });
};

/** Only the first definition of a link may change. Image uses keep the
 * destination as written, and all valid definition titles remain literal. */
export const markdownLinkDefinitions = (source: string): DefinitionEdit[] => {
  if (!source.includes(']:')) return [];
  if (source.length > MAX_DEFINITION_PARSE_LENGTH) return longPageDefinitionEdits(source);
  if (/<[A-Z]/.test(source)) {
    try {
      const parsed = collectDefinitions(source, true);
      return definitionEdits(parsed.definitions, parsed);
    } catch {
      // The total MDX + CommonMark parse size is at most twice the small-page cap.
    }
  }
  const parsed = collectDefinitions(source, false);
  return definitionEdits(parsed.definitions, parsed);
};

export const replaceImportReferences = (
  source: string,
  references: readonly ImportReference[],
  rewrite: (reference: ImportReference) => string,
): string => {
  const output: string[] = [];
  let cursor = 0;
  for (const reference of references) {
    output.push(source.slice(cursor, reference.start), rewrite(reference));
    cursor = reference.end;
  }
  output.push(source.slice(cursor));
  return output.join('');
};

export const htmlImageReferences = (source: string): ImportReference[] => {
  const references: ImportReference[] = [];
  for (const tag of source.matchAll(/<(?:img|Image)\b[^<>]*>/gi)) {
    const attribute = /\bsrc\s*=\s*(["'])([^"']*)["']/i.exec(tag[0]);
    if (!attribute) continue;
    const value = attribute[2] ?? '';
    const quote = attribute[0].indexOf(attribute[1] ?? '"');
    const start = tag.index + attribute.index + quote + 1;
    references.push({ value, start, end: start + value.length, image: true });
  }
  return references;
};

export const remoteImageSources = (content: string): string[] => {
  const prose = protectMarkdownCode(content).content;
  return [
    ...new Set(
      [...markdownReferences(prose).filter((reference) => reference.image), ...htmlImageReferences(prose)]
        .map((reference) => reference.value)
        .filter((value) => /^https?:\/\//i.test(value)),
    ),
  ];
};
