import { describe, expect, it } from 'vitest';
import { needsRichMarkdown } from './markdown';

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
});
