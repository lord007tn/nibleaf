/** `src/lib/markdown-scan.ts`: the Markdown reading the renderer
 * (`src/lib/markdown.tsx`) and the page outline (`src/lib/site.ts`) share. No
 * imports, so the same file runs in Nibleaf's tests
 * (markdown-scan.test.ts), which compare each function with the pattern it
 * replaces. */
export const markdownScanTemplate = (): string => String.raw`/**
 * Markdown reading for the renderer (./markdown.tsx) and the page outline
 * (./site.ts), in time linear in the text's length. Each function gives exactly
 * what the expression in its comment gives.
 */

const TICK = String.fromCharCode(96);
const WHITESPACE = /\s/;
const LINE_TERMINATOR = /[\n\r\u2028\u2029]/;

/**
 * Inline code spans in one paragraph, as [start, end) ranges: a run of
 * backticks opens a span that the next run of the same length closes. A run
 * that no later run matches stays text. Each run's closer is found once, from
 * the end.
 */
export const inlineCodeRanges = (text: string): Array<[number, number]> => {
  const starts: number[] = [];
  const lengths: number[] = [];
  for (let index = text.indexOf(TICK); index !== -1; ) {
    let end = index + 1;
    while (text[end] === TICK) end += 1;
    starts.push(index);
    lengths.push(end - index);
    index = text.indexOf(TICK, end);
  }
  const next: number[] = new Array(starts.length).fill(-1);
  const later = new Map<number, number>();
  for (let run = starts.length - 1; run >= 0; run -= 1) {
    const length = lengths[run] as number;
    next[run] = later.get(length) ?? -1;
    later.set(length, run);
  }
  const ranges: Array<[number, number]> = [];
  for (let run = 0; run < starts.length; ) {
    const close = next[run] as number;
    if (close === -1) {
      run += 1;
      continue;
    }
    ranges.push([starts[run] as number, (starts[close] as number) + (lengths[close] as number)]);
    run = close + 1;
  }
  return ranges;
};

/**
 * text.replace(/<(File|RelatedCard|Icon)\b([^>]*)\/>/gi, '<$1$2></$1>'): a
 * self-closing component becomes an explicit pair, which HTML parsers honor.
 * A tag ends at the first > after its name; when that > doesn't follow a /,
 * every opener before it fails the same way, so the scan moves past it.
 */
export const expandSelfClosingComponents = (text: string): string => {
  const opener = /<(File|RelatedCard|Icon)\b/gi;
  let output = '';
  let copied = 0;
  for (;;) {
    const open = opener.exec(text);
    if (!open) break;
    const nameEnd = open.index + open[0].length;
    const close = text.indexOf('>', nameEnd);
    if (close === -1) break;
    if (close > nameEnd && text[close - 1] === '/') {
      const name = open[1] as string;
      output += text.slice(copied, open.index) + '<' + name + text.slice(nameEnd, close - 1) + '></' + name + '>';
      copied = close + 1;
    }
    opener.lastIndex = close + 1;
  }
  return output + text.slice(copied);
};

/**
 * text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'): each link reads as its label.
 * Every [ before a ] reads up to that same ], so they all match or fail alike,
 * and the next ] and ) are each looked up once.
 */
export const stripMarkdownLinks = (text: string): string => {
  let output = '';
  let copied = 0;
  let from = 0;
  let bracket = -2;
  let paren = -2;
  for (;;) {
    const start = text.indexOf('[', from);
    if (start === -1) break;
    if (start + 1 >= text.length || text[start + 1] === ']') {
      from = start + 1;
      continue;
    }
    if (bracket !== -1 && bracket < start + 1) bracket = text.indexOf(']', start + 1);
    if (bracket === -1) break;
    if (text[bracket + 1] !== '(') {
      from = bracket + 1;
      continue;
    }
    if (paren !== -1 && paren < bracket + 2) paren = text.indexOf(')', bracket + 2);
    if (paren === -1) break;
    output += text.slice(copied, start) + text.slice(start + 1, bracket);
    copied = paren + 1;
    from = paren + 1;
  }
  return output + text.slice(copied);
};

/**
 * /^(#{2,3})\s+(.+?)\s*#*\s*$/.exec(line) as the heading's depth and text.
 * The text ends where only whitespace, closing #s and whitespace are left (or
 * after its first character, whichever is later), and holds no line
 * terminator; when it would, it starts earlier inside the whitespace run, as
 * the expression's backtracking does.
 */
export const headingParts = (line: string): { depth: 2 | 3; text: string } | null => {
  let hashes = 0;
  while (line[hashes] === '#') hashes += 1;
  if (hashes !== 2 && hashes !== 3) return null;
  let spaceEnd = hashes;
  while (spaceEnd < line.length && WHITESPACE.test(line[spaceEnd] as string)) spaceEnd += 1;
  if (spaceEnd === hashes) return null;
  let tail = line.length;
  while (tail > 0 && WHITESPACE.test(line[tail - 1] as string)) tail -= 1;
  while (tail > 0 && line[tail - 1] === '#') tail -= 1;
  while (tail > 0 && WHITESPACE.test(line[tail - 1] as string)) tail -= 1;
  const terminators: number[] = [0];
  for (let index = 0; index < line.length; index += 1) {
    terminators.push((terminators[index] as number) + (LINE_TERMINATOR.test(line[index] as string) ? 1 : 0));
  }
  for (let start = spaceEnd; start > hashes; start -= 1) {
    const end = Math.max(start + 1, tail);
    if (end > line.length) continue;
    if ((terminators[end] as number) === (terminators[start] as number)) return { depth: hashes === 2 ? 2 : 3, text: line.slice(start, end) };
  }
  return null;
};
`;
