import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { needsRichMarkdown } from '@/lib/reader-hydration-modules';
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
    const html = renderToStaticMarkup(createElement(RichMarkdown, { content: '```math\n\\sqrt{x^2+1}\n```' }));
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
