/**
 * Which pages load KaTeX (PUB-017): only those with math the rich renderer
 * draws. The parser-based reading and the line-scan fallback agree.
 */
import { describe, expect, it } from 'vitest';
import { markdownCodeUsage } from './markdown-code-usage';
import { readerRenderMode } from './reader-render-mode';
import { needsMathMarkdown } from './reader-rich';

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

  it('a math fence alone keeps a page on the plain renderer, as before', () => {
    expect(readerRenderMode('```math\n\\sqrt{2}\n```').rich).toBe(false);
  });
});
