import { describe, expect, it } from 'vitest';
import { closesMarkdownFence, fencedMarkdownLines, openingMarkdownFence, protectMarkdownCode } from './markdown-code';
import {
  CODERABBIT_REPROS,
  HTML_COMMENT_WITH_BANG_CLOSER,
  LAZY_INLINE_HTML_REPROS,
  LAZY_TEXT_AFTER_INLINE_HTML,
  ORDERED_LINE_UNDER_BULLET,
  TAB_BEFORE_QUOTE_IN_ITEM,
} from './testing/fence-cases';
import { mainFencedMarkdownLines } from './testing/markdown-code.main-reference';

describe('fencedMarkdownLines', () => {
  it('follows CommonMark fence pairing, also inside list items and blockquotes', () => {
    const lines = [
      'text',
      '````md',
      '```',
      'still code',
      '````',
      '> ~~~',
      '> quoted code',
      '> ~~~',
      '1. step',
      '   ```js',
      '   code',
      '   ```',
      'after',
    ];
    expect(fencedMarkdownLines(lines)).toEqual([false, true, true, true, true, true, true, true, false, true, true, true, false]);
  });
  it('treats a backtick run with backticks after it as inline code, not a fence', () => {
    expect(fencedMarkdownLines(['``` `inline` ```', 'text'])).toEqual([false, false]);
  });

  // Each expectation matches markdown-it's fence tokens for the same source.
  const flags = (source: string) => fencedMarkdownLines(source.split('\n')).map(Number).join('');
  it('ends a fence where its quote or list item ends, as CommonMark does', () => {
    expect(flags('> ```\n> code\nnot code\n## H')).toBe('1100');
    expect(flags('> ```\n> code\n\n## H')).toBe('1100');
    expect(flags('> > ```md\n> > example\n> after\n# H')).toBe('1100');
    expect(flags('- ```\n  a\nb\n## H')).toBe('1100');
    // The line that ends the item is read afresh: here it opens a new fence.
    expect(flags('- ```\n- b\n```\n# H')).toBe('1011');
  });
  it('keeps blank lines in a list item’s fence, and closes on any matching container prefix', () => {
    expect(flags('- ```\n  a\n\n  b\n  ```\nafter')).toBe('111110');
    expect(flags('> > ```md\n> > example\n>>```\nafter')).toBe('1110');
    expect(flags('1. >~~~md\n   > x\n   > ~~~\n\n## After')).toBe('11100');
  });
  it('measures container prefixes in columns, with tabs to the next multiple of 4', () => {
    expect(flags('>\t```md\n>\texample\n>\t```\nafter')).toBe('1110');
    expect(flags('- ```md\n\texample\n  ```\nafter')).toBe('1110');
    // A tab before the first marker is an indented code block, not a container (as on main).
    expect(flags('\t> ```md\n\t> code\n\t> ```\nafter')).toBe('0000');
  });
  it('treats a quote or list marker that first appears in a fence body as code', () => {
    expect(flags('> ```md\n> example\n> > ```\n> still code\n> ```\nafter')).toBe('111110');
    expect(flags('- ```md\n  example\n  - ```\n  still code\n  ```\nafter')).toBe('111110');
    expect(flags('```md\n> ```\nstill\n```\nafter')).toBe('11110');
  });
  it('reads a line indented 4+ columns past its containers or list item as indented code, never a fence', () => {
    expect(flags('>```js\n    [literal](/x)\n    ```\n\n## After\n\n<iframe></iframe>')).toBe('1000000');
    expect(flags('Text\n\n    ```js\n    # x\n\n## After')).toBe('000000');
    expect(flags('> a\n>\n>     ```js\n>     # x\n\n## After')).toBe('000000');
    // Indented only as far as the list item it continues: a fence.
    expect(flags('- a\n\n    ```js\n    # x\n    ```\nafter')).toBe('001110');
    expect(flags('1. a\n   - b\n\n     ```js\n     # x\n     ```\nafter')).toBe('0001110');
    expect(flags('> 1. a\n>\n>    ```js\n>    # x\n>    ```\nafter')).toBe('001110');
  });
  it('carries open list items and quotes across lines, so a fence on a continuation line ends with its item', () => {
    expect(flags('- item\n  ```md\n  code\n## After')).toBe('0110');
    expect(flags('- a\n  - b\n    ```md\n    code\n## After')).toBe('00110');
    expect(flags('- item\nlazy text\n  ```md\n  code\n## After')).toBe('00110');
    expect(flags('> - item\n>   ```md\n>   code\n> after\n## After')).toBe('01100');
    // CommonMark: the unindented line ends the item, so its closer opens a new fence.
    expect(flags('1. Install:\n   ```bash\nnpm i\n```\n## After')).toBe('01011');
  });
  it('lets a sibling ordered item open a fence, and reads a thematic break as no list item, as main and CommonMark do', () => {
    for (const [name, source, code] of CODERABBIT_REPROS) {
      expect(flags(source), name).toBe(code);
      expect(mainFencedMarkdownLines(source.split('\n')).map(Number).join(''), `${name}: main`).toBe(code);
    }
    // An ordered line under a bullet item starts a new list (markdown-it and
    // micromark agree): the fence after it is outside the item, as on main.
    const [source, code] = ORDERED_LINE_UNDER_BULLET;
    expect(flags(source)).toBe(code);
    expect(mainFencedMarkdownLines(source.split('\n')).map(Number).join('')).toBe(code);
  });
  it('reads the lines of an HTML block as HTML, and an empty item as a list item', () => {
    expect(flags('<div>\n```md\n</div>\n\n## After')).toBe('00000');
    expect(flags('<!--\n```md\n-->\n## After')).toBe('0000');
    expect(flags('para\n<span>\n```md\n# x\n```\n## After')).toBe('001110');
    expect(flags('- item\n-\n  ```md\n  x\n## After')).toBe('00110');
  });
  it('lets a type 7 HTML line continue a container paragraph lazily, so the fence after it stays code', () => {
    for (const [name, source, code] of LAZY_INLINE_HTML_REPROS) {
      expect(flags(source), name).toBe(code);
      expect(mainFencedMarkdownLines(source.split('\n')).map(Number).join(''), `${name}: main`).toBe(code);
    }
    // Inside the container, too; and types 1 to 6 still interrupt the paragraph.
    expect(flags('- item\n  <span>\n  ```md\n  # literal\n  ```\n## After')).toBe('001110');
    expect(flags('- item\n<div>\n```md\n# literal\n```\n## After')).toBe('000000');
  });
  it('keeps a list paragraph open across lazy text after inline HTML, so the fence ends with the item', () => {
    const { source, code, mainCode } = LAZY_TEXT_AFTER_INLINE_HTML;
    expect(flags(source)).toBe(code);
    // Main lost the paragraph on the `<span>` line and hid `## After`.
    expect(mainFencedMarkdownLines(source.split('\n')).map(Number).join('')).toBe(mainCode);
  });
  it('opens a quoted fence after a tab inside a list item (#592)', () => {
    const [source, code] = TAB_BEFORE_QUOTE_IN_ITEM;
    expect(flags(source)).toBe(code);
  });
  it('ends an HTML comment block at `-->` only, not at `--!>` (CommonMark, as markdown-it reads it)', () => {
    // Ending at `--!>` would open the fence on line 3 and hide `## After` (`001111`).
    expect(flags(HTML_COMMENT_WITH_BANG_CLOSER)).toBe('000000');
  });
  it('closes a fence in deeply nested list items', () => {
    expect(flags('- - - ```\n      x\n      ```\n## After')).toBe('1110');
  });
  it('still accepts any indentation for a fence in a component, as authors write it', () => {
    expect(flags('<Tabs>\n    ```js\n    # not a heading\n    ```\n</Tabs>\n# Heading')).toBe('011100');
  });
});

describe('import Markdown code boundaries', () => {
  it.each(['$&', '$$', "$'", '$`'])('restores replacement metacharacters literally in inline and fenced code: %s', (token) => {
    const input = [`before \`\`literal ${token}\`\``, '~~~', `literal ${token}`, '~~~', 'after'].join('\n');
    const protectedCode = protectMarkdownCode(input);
    expect(protectedCode.restore(protectedCode.content)).toBe(input);
  });

  it.each([
    '````mdx\r\n<img src="literal" />\r\n```\r\n~~~~\r\n`````\r\n',
    '~~~mdx\n![Example](literal)\n~~\n~~~\n',
    '```mdx\n<img src="literal" />',
  ])('preserves exact fenced source and only transforms prose', (literal) => {
    const input = `before\n${literal}`;
    const protectedCode = protectMarkdownCode(input);
    expect(protectedCode.content).not.toContain('literal');
    expect(protectedCode.restore(protectedCode.content.replaceAll('before', 'after'))).toBe(`after\n${literal}`);
  });

  it('resumes prose after a matching close and preserves variable-length multiline inline code', () => {
    const literal = '``<img src="literal" />\n`nested` ``';
    const input = `~~~\ncode\n~~~\n${literal}\n![Real](real)`;
    const protectedCode = protectMarkdownCode(input);
    expect(protectedCode.content).not.toContain('literal');
    expect(protectedCode.restore(protectedCode.content.replaceAll('(real)', '(hosted)'))).toBe(input.replaceAll('(real)', '(hosted)'));
  });

  it('restores a large page with many fences in one pass', () => {
    const input = '```\n'.repeat(100_000);
    const protectedCode = protectMarkdownCode(input);
    expect(protectedCode.restore(protectedCode.content)).toBe(input);
  });

  it('keeps placeholder-shaped text inside a literal unchanged', () => {
    const input = 'one `first` and `second`';
    const protectedCode = protectMarkdownCode(input);
    const placeholder = protectedCode.content.match(/\uE000[^\uE001]+\uE001/)?.[0] ?? '';
    expect(protectedCode.restore(`${placeholder} ${protectedCode.content}`)).toBe(`\`first\` ${input}`);
  });

  it('leaves unmatched and escaped inline delimiters as prose', () => {
    const input = '\\`escaped and `unmatched';
    const protectedCode = protectMarkdownCode(input);
    expect(protectedCode.content).toBe(input);
    expect(protectedCode.restore(protectedCode.content)).toBe(input);
  });

  it('shares matching rules with the MDX normalizer', () => {
    expect(openingMarkdownFence('```bad`info')).toBeUndefined();
    expect(openingMarkdownFence('    ```')).toBeUndefined();
    expect(openingMarkdownFence('    ```', Number.POSITIVE_INFINITY)).toEqual({ marker: '`', length: 3 });
    const fence = { marker: '`', length: 4 };
    expect(closesMarkdownFence('~~~', fence)).toBe(false);
    expect(closesMarkdownFence('```', fence)).toBe(false);
    expect(closesMarkdownFence('`````', fence)).toBe(true);
  });
});
