import { protectMarkdownCode } from '@nibleaf/shared/markdown-code';
import { type CompileContext, type Extension, fromMarkdown } from 'mdast-util-from-markdown';
import { mdxFromMarkdown } from 'mdast-util-mdx';
import { mdxjs } from 'micromark-extension-mdxjs';
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

// micromark's inline resolution can be quadratic in paragraph length. Bound the
// entire parse, since a reference and its definition can be anywhere on the page.
const MAX_DEFINITION_PARSE_LENGTH = 4096;

/** Read valid destination spans from the parser while keeping source spelling,
 * including escapes. Only the first definition of an actual link qualifies.
 * A definition shared with an image keeps the image's destination. */
export const markdownLinkDefinitions = (source: string): ImportReference[] => {
  if (source.length > MAX_DEFINITION_PARSE_LENGTH || !source.includes(']:')) return [];
  const collect = (mdx: boolean): ImportReference[] => {
    const destinations = new Map<string, ImportReference>();
    const spans: Extension = {
      exit: {
        definitionDestination(token) {
          const node = this.stack.at(-1);
          const from = token.start.offset;
          const to = token.end.offset;
          if (node?.type !== 'definition' || from === undefined || to === undefined || destinations.has(node.identifier)) return;
          const bracketed = source[from] === '<';
          const start = from + Number(bracketed);
          const end = to - Number(bracketed);
          destinations.set(node.identifier, { value: source.slice(start, end), start, end, image: false });
        },
      },
    };
    const tree = fromMarkdown(source, mdx ? { extensions: [mdxjs()], mdastExtensions: [mdxFromMarkdown(), spans] } : { mdastExtensions: [spans] });
    const links = new Set<string>();
    const images = new Set<string>();
    const pending: CompileContext['stack'] = [tree];
    for (const node of pending) {
      if (node.type === 'linkReference' && !node.identifier.startsWith('^')) links.add(node.identifier);
      if (node.type === 'imageReference') images.add(node.identifier);
      if ('children' in node) for (const child of node.children) pending.push(child);
    }
    return [...destinations].flatMap(([label, span]) => (span.value && links.has(label) && !images.has(label) ? [span] : []));
  };
  // CommonMark handles raw HTML. MDX syntax additionally recognizes a
  // definition immediately inside a component's opening and closing lines.
  if (/<[A-Z]/.test(source)) {
    try {
      return collect(true);
    } catch {
      return collect(false);
    }
  }
  return collect(false);
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
