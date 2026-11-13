/**
 * Generated fenced and indented code examples in quotes, list items and MDX
 * wrappers, each followed by sentinel prose. The generator and seed are the ones
 * the importer's scanner property test uses (`import-code.property.test.ts`,
 * #582), so the same 3,072 sources reach the shared fence scanner. Test-only.
 */
export const FENCE_CASE_SEED = 0x58_23_6b_09;
export const FENCE_CASE_COUNT = 3072;

export type FalseCloser = 'none' | 'wrong character' | 'too short' | 'new quote' | 'new list';

export interface FenceCase {
  index: number;
  /** The whole article: wrappers, the example, a blank line and the sentinel. */
  source: string;
  /** Wrapper opening lines and the example, without the closing wrapper or sentinel. */
  codeExample: string;
  /** Line range of the example in `source` (end exclusive). */
  exampleStart: number;
  exampleEnd: number;
  /** A fenced example; every fifth case is an indented code block instead. */
  fenced: boolean;
  prefix: string;
  wrapper: 'none' | 'single-line' | 'multiline' | 'self-closing';
  falseCloser: FalseCloser;
  marker: '`' | '~';
  /** Opening and closing fence lengths. */
  length: number;
  closerLength: number;
}

export const fenceCases = (seed = FENCE_CASE_SEED, count = FENCE_CASE_COUNT): FenceCase[] => {
  let state = seed;
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
  const choose = <T>(values: readonly [T, ...T[]]): T => values[next() % values.length] ?? values[0];
  const cases: FenceCase[] = [];
  for (let index = 0; index < count; index++) {
    const parts = Array.from({ length: next() % 4 }, () => choose(['>', '> ', '>\t', '- ', '1. ', '\t'] as const));
    const prefix = parts.join('');
    const continuation = parts.map((part) => (part === '- ' ? '  ' : part === '1. ' ? '   ' : part === '>' ? '> ' : part)).join('');
    const marker = choose(['`', '~'] as const);
    const length = 3 + (next() % 3);
    const closer = marker.repeat(length + (next() % (6 - length)));
    const falseCloser = choose(['none', 'wrong character', 'too short', 'new quote', 'new list'] as const);
    const falseLine =
      falseCloser === 'none'
        ? []
        : [
            continuation +
              (falseCloser === 'new quote' ? '> ' : falseCloser === 'new list' ? '- ' : '') +
              (falseCloser === 'wrong character' ? (marker === '`' ? '~' : '`') : marker).repeat(falseCloser === 'too short' ? length - 1 : length),
            `${continuation}[Still literal](/literal)`,
          ];
    const selectedWrapper = choose(['none', 'single-line', 'multiline', 'self-closing'] as const);
    const fenced = index % 5 !== 0;
    const wrapper = fenced ? selectedWrapper : 'none';
    const opening =
      wrapper === 'single-line'
        ? ['<CodeGroup>']
        : wrapper === 'multiline'
          ? ['<CodeGroup', '  title="Example > sample"', '>']
          : wrapper === 'self-closing'
            ? ['<Example', '  title="Literal />"', '/>']
            : [];
    const closing = wrapper === 'single-line' || wrapper === 'multiline' ? ['</CodeGroup>'] : [];
    const example = fenced
      ? [`${prefix}${marker.repeat(length)}md`, `${continuation}[Literal](/literal)`, ...falseLine, `${continuation}${closer}`]
      : [`${prefix}Example:`, '', `${continuation}    [Literal](/literal)`, `${continuation}    /`];
    const sentinel = `[Sentinel ${index}](/sentinel)`;
    cases.push({
      index,
      source: [...opening, ...example, ...closing, '', sentinel].join('\n'),
      codeExample: [...opening, ...example].join('\n'),
      exampleStart: opening.length,
      exampleEnd: opening.length + example.length,
      fenced,
      prefix,
      wrapper,
      falseCloser,
      marker,
      length,
      closerLength: closer.length,
    });
  }
  return cases;
};

/** #587's repros: fences in quotes and lists that main's scanner leaves open to
 * the end of the page. Each is followed by `AFTER_FENCE` in the reader tests. */
export const FENCE_CONTAINER_REPROS: ReadonlyArray<readonly [name: string, source: string]> = [
  ['a fence in a quote in a numbered list, no false closer (case 303)', '1. >~~~md\n   > [Literal](/literal)\n   > ~~~'],
  ['a fence in a quote in a bullet list, closed by a longer fence (case 1838)', '- > ````md\n  > [Literal](/literal)\n  > `````'],
  ['a quoted fence whose body starts a nested quote', '> ```md\n> example\n> > ```\n> still code\n> ```'],
  ['a list fence whose body starts a nested list item', '- ```md\n  example\n  - ```\n  still code\n  ```'],
  ['a tilde fence with a quoted false closer, closed by a longer fence', '~~~~md\nexample\n> ~~~~\nstill code\n~~~~~'],
];

/** A heading and a video after the code, which the reader must keep (#587). */
export const AFTER_FENCE = '\n\n## After\n\n<iframe src="https://www.youtube.com/embed/M7lc1UVf-VE" title="Tour"></iframe>';

/** Council P2 on #590: after a quote ends a fence, an indented line that looks
 * like a fence is indented code (CommonMark), not a new, unclosed fence. */
export const INDENTED_FENCE_AFTER_QUOTE =
  '>```js\n    [literal](/x)\n    ```\n\n## After\n\n<iframe src="https://www.youtube.com/embed/M7lc1UVf-VE"></iframe>';

export interface IndentedLookalikeCase {
  index: number;
  source: string;
  /** Lines that look like fences but are indented code: never fenced. */
  lookalikes: number[];
  /** Lines of a real fence before them. */
  fenced: number[];
}

/**
 * Indented code whose lines look like fences, in quotes and list items: after a
 * blank line inside the container, or after a quote that ended a real fence.
 * Each is followed by sentinel prose. A separate category from `fenceCases`, so
 * that generator (and the numbers pinned on it) stays as #582 made it.
 */
export const indentedLookalikeCases = (seed = FENCE_CASE_SEED, count = 1024): IndentedLookalikeCase[] => {
  let state = seed ^ 0x2f_6b_1d_47;
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
  const choose = <T>(values: readonly [T, ...T[]]): T => values[next() % values.length] ?? values[0];
  const cases: IndentedLookalikeCase[] = [];
  for (let index = 0; index < count; index++) {
    const fence = choose(['`', '~'] as const).repeat(3 + (next() % 3));
    const closed = next() % 2 === 0;
    const sentinel = `[Sentinel ${index}](/sentinel)`;
    if (index % 4 === 0) {
      // A quoted fence that a line outside the quote ends, then indented code.
      const quotes = Array.from({ length: 1 + (next() % 3) }, () => choose(['>', '> '] as const)).join('');
      const lines = [`${quotes}${fence}js`, '    [literal](/x)', `    ${fence}md`, ...(closed ? [`    ${fence}`] : []), '', sentinel];
      cases.push({ index, source: lines.join('\n'), fenced: [0], lookalikes: closed ? [2, 3] : [2] });
      continue;
    }
    const parts = Array.from({ length: next() % 4 }, () => choose(['>', '> ', '- ', '1. '] as const));
    const prefix = parts.join('');
    const continuation = parts.map((part) => (part === '- ' ? '  ' : part === '1. ' ? '   ' : '> ')).join('');
    const extra = ' '.repeat(next() % 3);
    const lines = [
      `${prefix}Example:`,
      continuation.trimEnd(),
      `${continuation}    ${extra}${fence}md`,
      `${continuation}    ${extra}[Literal](/literal)`,
      ...(closed ? [`${continuation}    ${extra}${fence}`] : []),
      '',
      sentinel,
    ];
    cases.push({ index, source: lines.join('\n'), fenced: [], lookalikes: closed ? [2, 4] : [2] });
  }
  return cases;
};

/** CodeRabbit on #590: a fence opened on a list item's continuation line belongs
 * to that item and ends where the item does. Each source ends with `## After`;
 * `code` flags its lines (1 = fenced code), as markdown-it reads them. */
export const CONTINUATION_FENCE_REPROS: ReadonlyArray<readonly [name: string, source: string, code: string]> = [
  ['a fence on a bullet item continuation line', '- item\n  ```md\n  code\n## After', '0110'],
  ['a fence on a nested item continuation line', '- a\n  - b\n    ```md\n    code\n## After', '00110'],
  ['a fence after a blank line in an item', '- item\n\n  ```md\n  code\n## After', '00110'],
  ['a fence on a continuation line of an item in a quote', '> - item\n>   ```md\n>   code\n## After', '0110'],
  ['a fence on a continuation line of an item in a quote, left inside the quote', '> - item\n>   ```md\n>   code\n> after\n## After', '01100'],
  ['a fence on a numbered item continuation line', '1. step\n   ```bash\n   npm i\n## After', '0110'],
  ['a fence in a list, quote and numbered item, left at each level', '- a\n  > 1. b\n  >    ```md\n  >    code\n  > after\n## After', '001100'],
  ['a fence after a lazy paragraph line in an item', '- item\nlazy text\n  ```md\n  code\n## After', '00110'],
];

/** What follows each continuation repro's `## After`: a video the reader must keep. */
export const AFTER_CONTINUATION = '\n\n<iframe src="https://www.youtube.com/embed/M7lc1UVf-VE" title="Tour"></iframe>';

export interface ContinuationFenceCase {
  index: number;
  source: string;
  /** Lines of the fence (opener and body, and its closer when closed). */
  fenced: number[];
  /** Lines after the fence that must not be code. */
  prose: number[];
}

/**
 * Fences opened on the continuation line of a list item or quote: after the
 * item's first line, a lazy paragraph line or a blank line, then closed, or
 * ended by a line that leaves the page's containers or only the innermost one.
 * Each is followed by sentinel prose.
 */
export const continuationFenceCases = (seed = FENCE_CASE_SEED, count = 1024): ContinuationFenceCase[] => {
  let state = seed ^ 0x51_3a_c0_7d;
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
  const choose = <T>(values: readonly [T, ...T[]]): T => values[next() % values.length] ?? values[0];
  const continuationOf = (part: string) => (part === '> ' ? '> ' : ' '.repeat(part.length));
  const cases: ContinuationFenceCase[] = [];
  for (let index = 0; index < count; index++) {
    const parts = Array.from({ length: 1 + (next() % 3) }, () => choose(['> ', '- ', '* ', '1. ', '10. '] as const));
    const continuation = parts.map(continuationOf).join('');
    const fence = choose(['`', '~'] as const).repeat(3 + (next() % 3));
    const before = choose(['none', 'lazy', 'blank'] as const);
    const ending = choose(['closed', 'leave all', 'leave innermost'] as const);
    const lines = [`${parts.join('')}item ${index}`];
    if (before === 'lazy') lines.push('lazy text');
    if (before === 'blank') lines.push(continuation.trimEnd());
    const opener = lines.length;
    lines.push(`${continuation}${fence}md`, `${continuation}code`);
    const fenced = [opener, opener + 1];
    if (ending === 'closed') {
      fenced.push(lines.length);
      lines.push(`${continuation}${fence}`);
    } else if (ending === 'leave all' || parts.length === 1) lines.push('## After');
    else lines.push(`${parts.slice(0, -1).map(continuationOf).join('')}after`);
    const prose = ending === 'closed' ? [] : [lines.length - 1];
    lines.push('', `[Sentinel ${index}](/sentinel)`);
    prose.push(lines.length - 1);
    cases.push({ index, source: lines.join('\n'), fenced, prose });
  }
  return cases;
};

/** CodeRabbit on f505b2a9: (A) a sibling ordered item may open a fence, (B) a
 * thematic break opens no list item, (C) an ordered line under a bullet item
 * starts a new list rather than continuing lazily. `code` is how markdown-it
 * (and micromark) read each source; main 93408093 reads all three the same way. */
export const CODERABBIT_REPROS: ReadonlyArray<readonly [name: string, source: string, code: string]> = [
  ['a fence on a sibling ordered item', '1. first\n2. ```md\n   # literal\n   ```\n## After', '01110'],
  ['a fence on a sibling ordered item starting at 3', '3. a\n4. b\n5. ```md\n   # literal\n   ```\n## After', '001110'],
  ['a fence after a spaced `- - -` thematic break', '- - -\n  ```md\n# literal\n  ```\n## After', '01110'],
  ['a fence after a `* * *` thematic break', '* * *\n  ```md\n# literal\n  ```\n## After', '01110'],
  ['a fence after a `_ _ _` thematic break', '_ _ _\n```md\n# literal\n```\n## After', '01110'],
  ['a fence after a thematic break in a quote', '> - - -\n> ```md\n> # literal\n> ```\n## After', '01110'],
  ['a fence after an indented thematic break in an item', '- a\n  * * *\n  ```md\n  # literal\n  ```\n## After', '001110'],
];
/** CodeRabbit's (C): CommonMark itself reads the rest as code here, so `## After` is not a heading. */
export const ORDERED_LINE_UNDER_BULLET = ['- item\n2. lazy\n  ```md\n  code\n## After', '00111'] as const;

export type DifferentialCategory = 'ordered siblings' | 'thematic breaks' | 'lazy ordered lines' | 'setext underlines' | 'HTML blocks';
export interface DifferentialCase {
  index: number;
  category: DifferentialCategory;
  /** Whether the shape sits inside a quote or list item. */
  nested: boolean;
  source: string;
}

/**
 * Shapes around a fence that exercise CommonMark's block rules: ordered items
 * with any start number and their siblings, thematic breaks (spaced and not),
 * lazy ordered lines and empty items, setext underlines and HTML blocks (types
 * 1, 2, 6 and 7), each at the top level or nested in quotes and list items.
 * Compared with markdown-it line for line.
 */
export const differentialCases = (seed = FENCE_CASE_SEED, perCategory = 512): DifferentialCase[] => {
  let state = seed ^ 0x6c_1f_93_a5;
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
  const choose = <T>(values: readonly [T, ...T[]]): T => values[next() % values.length] ?? values[0];
  const fence = () => choose(['`', '~'] as const).repeat(3 + (next() % 2));
  const shapes: Record<DifferentialCategory, () => string[]> = {
    'ordered siblings': () => {
      const delimiter = choose(['.', ')'] as const);
      const start = choose([0, 1, 2, 3, 7, 9, 10, 99] as const);
      const before = next() % 3;
      const lines = Array.from({ length: before + 1 }, (_, item) => `${start + item}${delimiter} item`);
      const marker = `${start + before + 1}${delimiter} `;
      const pad = ' '.repeat(marker.length);
      const f = fence();
      lines.push(`${marker}${f}md`, `${pad}# literal`, choose([`${pad}${f}`, f, `${pad}text`] as const));
      return lines;
    },
    'thematic breaks': () => {
      const rule = choose(['- - -', '* * *', '_ _ _', '---', '***', '___', '-  -  -', '*\t*\t*', ' - - -', '  ***', '- -', '* *', '- * -'] as const);
      const f = fence();
      const indent = choose(['', '  ', ' '] as const);
      return [rule, `${indent}${f}md`, '# literal', `${indent}${f}`];
    },
    'lazy ordered lines': () => {
      const item = choose(['- item', '* item', '1. item', '+ item'] as const);
      const lazy = choose(['2. lazy', '1. lazy', '3) lazy', '10. lazy', '-', '- lazy', 'lazy text'] as const);
      const f = fence();
      const pad = ' '.repeat(item.indexOf(' ') + 1);
      return [item, lazy, `${pad}${f}md`, `${pad}code`, choose([`${pad}${f}`, `${pad}text`] as const)];
    },
    'setext underlines': () => {
      const underline = choose(['===', '---', '-', '=', '- -', '----   '] as const);
      const f = fence();
      return [choose(['para', '# heading', ''] as const), underline, `${f}md`, '# literal', f];
    },
    'HTML blocks': () => {
      const open = choose(['<div>', '<details>', '<!--', '<span>', '<img src="x" />', '<pre>', '</div>', '<custom-tag a="1">', '<p'] as const);
      const close = open === '<!--' ? '-->' : open === '<pre>' ? '</pre>' : '</div>';
      const f = fence();
      const before = choose(['', 'para'] as const);
      const gap = choose(['', 'blank'] as const);
      return [...(before ? [before] : []), open, ...(gap ? [''] : []), `${f}md`, '# literal', ...(next() % 2 ? [f] : []), close];
    },
  };
  const prefixes: ReadonlyArray<readonly [first: string, rest: string]> = [
    ['> ', '> '],
    ['- ', '  '],
    ['1. ', '   '],
    ['> - ', '>   '],
    ['- > ', '  > '],
  ];
  const cases: DifferentialCase[] = [];
  let index = 0;
  for (const category of Object.keys(shapes) as DifferentialCategory[]) {
    for (let count = 0; count < perCategory; count++) {
      const shape = shapes[category]();
      const nested = next() % 2 === 0;
      const [first, rest] = nested ? choose(prefixes as [readonly [string, string], ...(readonly [string, string])[]]) : ['', ''];
      const body = shape.map((line, position) => (position === 0 ? first : rest) + line).map((line) => (line.trim() ? line : line.trimEnd()));
      cases.push({ index: index++, category, nested, source: [...body, '## After', '', `[Sentinel ${index}](/sentinel)`].join('\n') });
    }
  }
  return cases;
};
