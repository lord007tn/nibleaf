import { type BlockContext, GFM, type Line, parser } from '@lezer/markdown';
import { parse, postprocess, preprocess } from 'micromark';
import { gfm } from 'micromark-extension-gfm';

interface LineMetrics {
  start: number;
  columns: number[];
  tail?: { marker: string | undefined; start: number; third: number };
}
const metrics = new WeakMap<BlockContext, LineMetrics>();
const lineMetrics = (context: BlockContext, line: Line): LineMetrics => {
  const previous = metrics.get(context);
  if (previous?.start === context.lineStart) return previous;
  const columns = [0];
  let column = 0;
  for (let at = 0; at < line.text.length; at++) {
    column += line.text[at] === '\t' ? 4 - (column % 4) : 1;
    while (columns.length <= column) columns.push(at + 1);
  }
  const result = { start: context.lineStart, columns };
  metrics.set(context, result);
  return result;
};
const space = (character: string | undefined) => character === ' ' || character === '\t' || character === '\r' || character === '\n';

/** Lezer exposes block-parser extensions and column lookup. Cache its repeated
 * column/thematic-tail queries once per line: nested lists otherwise rescan the
 * same prefixes/tails quadratically. The Markdown grammar is unchanged. */
const structureParser = parser.configure([
  GFM,
  {
    parseBlock: [
      {
        name: 'ExportColumns',
        before: 'IndentedCode',
        parse(context, line) {
          line.findColumn = (goal) => {
            if (!(goal > 0)) return 0;
            const { columns } = lineMetrics(context, line);
            return columns[Math.min(Math.ceil(goal), columns.length - 1)] ?? line.text.length;
          };
          return false;
        },
      },
      {
        name: 'HorizontalRule',
        parse(context, line) {
          if (![42, 45, 95].includes(line.next)) return false;
          const current = lineMetrics(context, line);
          if (!current.tail) {
            let at = line.text.length - 1;
            while (at >= 0 && space(line.text[at])) at--;
            const marker = line.text[at];
            let count = 0;
            let third = -1;
            for (; at >= 0 && (line.text[at] === marker || space(line.text[at])); at--) {
              if (line.text[at] === marker && ++count === 3) third = at;
            }
            current.tail = { marker, start: at + 1, third };
          }
          const tail = current.tail;
          if (line.text[line.pos] !== tail.marker || line.pos < tail.start || line.pos > tail.third) return false;
          const node = context.elt('HorizontalRule', context.lineStart + line.pos, context.lineStart + line.text.length);
          context.nextLine();
          context.addElement(node);
          return true;
        },
      },
    ],
  },
]);

interface ExportRange {
  from: number;
  to: number;
}
interface ExportCode extends ExportRange {
  value: string;
}
interface ExportBlock extends ExportRange {
  depth: number;
  work: number;
  limited: boolean;
  html: (ExportRange & { block: boolean })[];
  links: ExportRange[];
}
const codeNames = new Set(['FencedCode', 'CodeBlock', 'InlineCode']);
const htmlNames = new Set(['HTMLBlock', 'HTMLTag', 'CommentBlock', 'ProcessingInstructionBlock']);
const linkNames = new Set(['Link', 'Image', 'Autolink', 'LinkReference']);

/** Source positions from a real Markdown parser. Its code subtrees are opaque;
 * only actual container nodes contribute depth. Traversal uses a cursor, not recursion. */
export const exportMarkdownStructure = (source: string) => {
  const tree = structureParser.parse(source);
  const code: ExportCode[] = [];
  const blocks: ExportBlock[] = [];
  const protectedCode = new Uint8Array(source.length);
  const lineStarts = [0];
  for (let at = source.indexOf('\n'); at >= 0; at = source.indexOf('\n', at + 1)) lineStarts.push(at + 1);
  let codeLine = 0;
  const root = tree.cursor();
  if (root.firstChild())
    do {
      const block: ExportBlock = { from: root.from, to: root.to, depth: 0, work: root.to - root.from, limited: false, html: [], links: [] };
      const cursor = root.node.cursor();
      let level = 0;
      for (;;) {
        const range = { from: cursor.from, to: cursor.to };
        const isCode = codeNames.has(cursor.name);
        block.depth = Math.max(block.depth, level);
        if (isCode) {
          // Ignore only container syntax that the Markdown parser recognized.
          // Keep indentation, span delimiters, fence lengths and literal text.
          let from = cursor.name === 'CodeBlock' ? Math.max(source.lastIndexOf('\n', range.from - 1) + 1, range.from - 4) : range.from;
          const pieces: string[] = [];
          const marks = cursor.node.getChildren('QuoteMark');
          for (let at = 0; at < marks.length; ) {
            const first = marks[at];
            if (!first) break;
            while ((lineStarts[codeLine + 1] ?? Number.POSITIVE_INFINITY) <= first.from) codeLine++;
            const lineFrom = lineStarts[codeLine] ?? 0;
            const lineEnd = lineStarts[codeLine + 1] ?? source.length;
            let last = first;
            while (marks[at + 1] && (marks[at + 1]?.from ?? Number.POSITIVE_INFINITY) < lineEnd) last = marks[++at] ?? last;
            pieces.push(source.slice(from, Math.max(from, lineFrom)));
            from = last.to + (source[last.to] === ' ' ? 1 : 0);
            at++;
          }
          pieces.push(source.slice(from, range.to));
          code.push({ ...range, value: pieces.join('') });
          protectedCode.fill(1, range.from, range.to);
          block.work -= range.to - range.from;
        } else {
          if (htmlNames.has(cursor.name)) block.html.push({ ...range, block: cursor.name !== 'HTMLTag' });
          if (linkNames.has(cursor.name)) block.links.push(range);
        }
        if (!isCode && !htmlNames.has(cursor.name) && cursor.firstChild()) {
          level++;
          continue;
        }
        let finished = false;
        for (;;) {
          if (level === 0) {
            finished = true;
            break;
          }
          if (cursor.nextSibling()) break;
          cursor.parent();
          level--;
        }
        if (finished) break;
      }
      blocks.push(block);
    } while (root.nextSibling());
  // Lezer bounds recursion before the reader's CommonMark parser runs. Its HTML
  // grammar differs around blank container lines, so only CommonMark events
  // decide which bytes are actual code, HTML or link syntax in bounded blocks.
  const input = source.split('');
  for (const block of blocks) block.limited = block.depth > 64 || block.work > 262_144;
  const boundedCode: ExportCode[] = [];
  let codeAt = 0;
  for (const block of blocks) {
    while (codeAt < code.length && (code[codeAt]?.from ?? Number.POSITIVE_INFINITY) < block.to) {
      const item = code[codeAt++];
      if (item && block.limited) boundedCode.push(item);
    }
    if (block.limited) {
      for (let at = block.from; at < block.to; at++) if (source[at] !== '\n' && source[at] !== '\r') input[at] = ' ';
    } else {
      block.html = [];
      block.links = [];
    }
  }
  protectedCode.fill(0);
  for (const item of boundedCode) protectedCode.fill(1, item.from, item.to);
  const actualCode: ExportCode[] = [];
  let blockAt = 0;
  for (const [kind, token, context] of postprocess(
    parse({ extensions: [gfm()] })
      .document()
      .write(preprocess()(input.join(''), undefined, true)),
  )) {
    if (kind !== 'enter') continue;
    const range = { from: token.start.offset, to: token.end.offset };
    if (['codeFenced', 'codeIndented', 'codeText'].includes(token.type)) {
      actualCode.push({ ...range, value: context.sliceSerialize(token) });
      protectedCode.fill(1, range.from, range.to);
    }
    while (blockAt < blocks.length && (blocks[blockAt]?.to ?? Number.POSITIVE_INFINITY) <= range.from) blockAt++;
    const block = blocks[blockAt];
    if (!block || block.limited) continue;
    if (token.type === 'htmlFlow' || token.type === 'htmlText') block.html.push({ ...range, block: token.type === 'htmlFlow' });
    if (['link', 'image', 'definition', 'autolink'].includes(token.type)) block.links.push(range);
  }
  const mergedCode: ExportCode[] = [];
  let actualAt = 0;
  let boundedAt = 0;
  while (actualAt < actualCode.length || boundedAt < boundedCode.length) {
    const next =
      (actualCode[actualAt]?.from ?? Number.POSITIVE_INFINITY) <= (boundedCode[boundedAt]?.from ?? Number.POSITIVE_INFINITY)
        ? actualCode[actualAt++]
        : boundedCode[boundedAt++];
    if (next) mergedCode.push(next);
  }
  return { blocks, code: mergedCode, protectedCode };
};
