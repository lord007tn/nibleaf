import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { needsRichMarkdown } from '@/lib/reader-hydration-modules';
import { mathPlugins } from './markdown-math';
import RichMarkdown from './markdown-rich';

describe('conditional Markdown renderer', () => {
  it('keeps ordinary GFM on the lightweight renderer', () => {
    expect(needsRichMarkdown('# Hello\n\n- one\n- two\n\n```ts\nconst x = 1\n```')).toBe(false);
  });

  it.each(['Inline $x^2$ math', '$$\\frac{a}{b}$$', '<Callout type="tip">Useful</Callout>', '<table><tr><td>Raw</td></tr></table>'])(
    'uses the SSR-capable rich renderer for %s',
    (content) => expect(needsRichMarkdown(content)).toBe(true),
  );

  it('does not mistake escaped dollar signs for math', () => {
    expect(needsRichMarkdown('The plan costs \\$5 per month.')).toBe(false);
  });

  it('preserves code math markers through sanitization before generating accessible KaTeX markup', () => {
    const html = renderToStaticMarkup(
      createElement(RichMarkdown, {
        content: '<code class="math-inline" style="position:fixed" onclick="alert(1)">\\frac{1}{2}</code>',
        math: mathPlugins,
      }),
    );
    expect(html).toContain('<math xmlns="http://www.w3.org/1998/Math/MathML">');
    expect(html).toContain('<annotation encoding="application/x-tex">\\frac{1}{2}</annotation>');
    expect(html).toContain('class="katex-html" aria-hidden="true"');
    expect(html).toContain('style="height:');
    expect(html).not.toContain('position:fixed');
    expect(html).not.toContain('onclick');
  });

  it('renders fenced math as display math using the same sanitized pipeline', () => {
    const html = renderToStaticMarkup(createElement(RichMarkdown, { content: '```math\n\\sqrt{x^2+1}\n```', math: mathPlugins }));
    expect(html).toContain('class="katex-display"');
    expect(html).toContain('class="katex-mathml"');
    expect(html).toContain('class="katex-html" aria-hidden="true"');
    expect(html).not.toContain('language-math');
  });

  it("keeps the editor's underline, subscript and superscript", () => {
    const html = renderToStaticMarkup(createElement(RichMarkdown, { content: 'A <u>underlined</u> word, H<sub>2</sub>O and x<sup>2</sup>.' }));
    expect(html).toContain('<u>underlined</u>');
    expect(html).toContain('<sub>2</sub>');
    expect(html).toContain('<sup>2</sup>');
    // Allowed like any inline element: no handlers or styles.
    const styled = renderToStaticMarkup(createElement(RichMarkdown, { content: '<u style="color:red" onclick="alert(1)">x</u>' }));
    expect(styled).toContain('<u>x</u>');
  });
});

describe('KaTeX loads only for math (PUB-017)', () => {
  it('keeps KaTeX, its stylesheet and the math syntax out of the rich renderer', () => {
    const source = readFileSync(resolve(import.meta.dirname, 'markdown-rich.tsx'), 'utf8');
    expect(source).not.toMatch(/from 'rehype-katex'|from 'remark-math'|katex\.min\.css/);
    const math = readFileSync(resolve(import.meta.dirname, 'markdown-math.ts'), 'utf8');
    expect(math).toMatch(/from 'rehype-katex'/);
    expect(math).toMatch(/katex\.min\.css/);
  });

  it('renders math as plain text when the page did not ask for KaTeX', () => {
    const html = renderToStaticMarkup(createElement(RichMarkdown, { content: '<Note>Hi</Note>' }));
    expect(html).not.toContain('katex');
  });
});
