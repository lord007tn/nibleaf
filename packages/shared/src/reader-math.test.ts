/**
 * Which pages load KaTeX (PUB-017): only those with math the rich renderer
 * draws. The parser-based reading and the line-scan fallback agree.
 */
import { describe, expect, it } from 'vitest';
import { markdownCodeUsage } from './markdown-code-usage';
import { readerRenderMode } from './reader-render-mode';
import { needsMathMarkdown, needsRichMarkdown } from './reader-rich';

const CASES: Array<[string, string, { rich: boolean; math: boolean }]> = [
  ['an MDX component, no math', 'Intro.\n\n<Card title="Start">Go</Card>', { rich: true, math: false }],
  ['inline math', 'The area is $a^2$.', { rich: true, math: true }],
  ['an MDX component and a math fence', '<Note>Hi</Note>\n\n```math\n\\sqrt{2}\n```', { rich: true, math: true }],
  ['raw HTML that KaTeX renders', '<code class="math-inline">\\frac{1}{2}</code>', { rich: true, math: true }],
  ['dollars only in code', 'Run `echo $HOME and $PATH`.\n\n```bash\necho $A $B\n```', { rich: false, math: false }],
  ['plain Markdown', '# Title\n\n- one\n- two', { rich: false, math: false }],
];

describe('math detection', () => {
  it.each(CASES)('%s', (_name, content, expected) => {
    const mode = readerRenderMode(content);
    expect({ rich: mode.rich, math: mode.math }).toEqual(expected);
    expect(markdownCodeUsage(content)?.math).toBe(expected.math);
    // The line scan (past the parser's bounds) errs towards loading, never away from it.
    if (expected.math) expect(needsMathMarkdown(content)).toBe(true);
  });

  it.each([
    ['an entity-encoded math class', '<code class="math&#45;inline">\\frac{1}{2}</code>'],
    ['a hex-encoded math class', '<code class="math&#x2d;display">x^2</code>'],
    ['an entity-encoded language-math class', '<pre><code class="l&#97;nguage-math">x^2</code></pre>'],
    ['an escaped backslash before math on an MDX page', '<Note>Hi</Note>\n\n\\\\$x$ is the variable.'],
    ['a delimiter plain Markdown reads as a code span', '<Note>Hi</Note>\n\n$`x$`'],
    ['a delimiter in a link destination', '<Note>Hi</Note>\n\n$[x](https://example.com/$)'],
    ['a delimiter in an HTML attribute', '<Note>Hi</Note>\n\n$<span title="$">'],
    ['math in link text', '<Note>Hi</Note>\n\n[the $x$ axis](https://example.com)'],
    ['a math class with leading-zero decimal digits', '<code class="math&#0000000045;inline">x^2</code>'],
    ['a math class with leading-zero hex digits', '<code class="math&#x00000002d;inline">x^2</code>'],
  ])('loads KaTeX for %s, which the renderer typesets', (_name, content) => {
    const mode = readerRenderMode(content);
    expect(mode).toMatchObject({ rich: true, math: true });
    expect(needsMathMarkdown(content)).toBe(true);
  });

  it('does not load KaTeX for a math class named only in code', () => {
    for (const content of ['Use `math-inline` in CSS.', '```css\n.math-display { margin: 0 }\n```']) {
      // The page is not rich, so neither the renderer nor the preloader
      // (KaTeX only with the rich renderer) touches math, whatever the
      // conservative line scan says.
      expect(needsRichMarkdown(content), content).toBe(false);
      expect(readerRenderMode(content).math, content).toBe(false);
    }
  });

  it.each([
    ['an entity-encoded fence language', '<div></div>\n\n~~~m&#97;th\nx^2\n~~~'],
    ['a math class beside attribute backticks', '<code title="`" class="math-inline" data-x="`">x^2</code>'],
  ])('past the parser bounds, still loads KaTeX for %s on a rich page', (_name, body) => {
    const content = `${body}\n\n${'word '.repeat(80_001)}`;
    expect(markdownCodeUsage(content)).toBeNull();
    expect(readerRenderMode(content)).toMatchObject({ rich: true, math: true });
  });

  it('reads math on a rich page exactly as remark-math does: escaped and unpaired dollars are not math', () => {
    for (const content of ['<Note>Hi</Note>\n\nCosts \\$5 and \\$10.', '<Note>Hi</Note>\n\nPrices: $5.\n\nAnd $10 later.']) {
      expect(readerRenderMode(content), content).toMatchObject({ rich: true, math: false });
    }
  });

  it('keeps an escaped dollar escaped in the line scan', () => {
    expect(needsMathMarkdown('Costs \\$5 and \\$10.')).toBe(false);
  });

  it.each([
    ['a blockquote', '> ```math\n> x^2\n> ```'],
    ['a list item', '- ```math\n  x^2\n  ```'],
  ])('past the parser bounds, still loads KaTeX for a math fence in %s on a rich page', (_name, fence) => {
    const content = `<Note>Hi</Note>\n\n${fence}\n\n${'word '.repeat(80_001)}`;
    expect(content.length).toBeGreaterThan(400_000);
    expect(markdownCodeUsage(content)).toBeNull();
    expect(readerRenderMode(content)).toMatchObject({ rich: true, math: true });
  });

  it('past the parser bounds, gives every rich page KaTeX, even where only normalization reveals the math', () => {
    for (const body of ['<code class="ma{/* note */}th-inline">x^2</code>', '<Note>No math here</Note>']) {
      const content = `${body}\n\n${'word '.repeat(80_001)}`;
      expect(readerRenderMode(content), body).toMatchObject({ rich: true, math: true, usage: null });
    }
    // A plain page past the bounds still gets neither.
    expect(readerRenderMode(`# Title\n\n${'word '.repeat(80_001)}`)).toMatchObject({ rich: false, math: false });
  });

  it('scans a long backtick run in linear time', () => {
    // Unanchored, each backtick started a fresh match over the rest of the run:
    // about 1 s at 16,000 backticks, quadratic beyond.
    const content = `<Note>Hi</Note>\n\n${'`'.repeat(100_000)}`;
    const started = performance.now();
    needsMathMarkdown(content);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('a math fence alone keeps a page on the plain renderer, as before', () => {
    expect(readerRenderMode('```math\n\\sqrt{2}\n```').rich).toBe(false);
  });
});
