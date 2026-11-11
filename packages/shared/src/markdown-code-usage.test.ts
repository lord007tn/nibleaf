import { describe, expect, it } from 'vitest';
import { markdownCodeUsage } from './markdown-code-usage';

describe('markdownCodeUsage', () => {
  it('reads code languages the way the Markdown parser does', () => {
    expect(markdownCodeUsage('- > ```Rust\n  > fn main() {}\n  > ```\n\n```r&#117;st\nx\n```\n\n~~~ go title="a"\nx\n~~~')?.languages).toEqual([
      'go',
      'rust',
    ]);
    expect(markdownCodeUsage('<pre><code class="language-swift">let x = 1</code></pre>')).toEqual({ languages: ['swift'], rich: true });
  });

  it('needs the rich renderer for raw HTML or math in prose, not in code', () => {
    expect(markdownCodeUsage('> ```\n> code\n\nMath $x^2$.')?.rich).toBe(true);
    expect(markdownCodeUsage('Text with <kbd>Ctrl</kbd>.')?.rich).toBe(true);
    expect(markdownCodeUsage('```html\n<div>$x$</div>\n```\n\nUse `<b>` and `$HOME`.')?.rich).toBe(false);
    expect(markdownCodeUsage('It costs $5.')?.rich).toBe(false);
  });

  it('declines (null) past its safety bounds instead of parsing', () => {
    expect(markdownCodeUsage('*a'.repeat(50_000))).toBeNull();
    expect(markdownCodeUsage('word '.repeat(90_000))).toBeNull();
  });
});
