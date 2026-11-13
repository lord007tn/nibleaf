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
