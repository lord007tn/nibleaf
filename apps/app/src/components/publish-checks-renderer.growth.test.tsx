import { growthMs, growthTestsEnabled, linearGrowthLimit } from '@nibleaf/shared/testing/growth';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Markdown } from './markdown';

describe.runIf(growthTestsEnabled)('reader fallback for over-budget Markdown', () => {
  it('renders blocks over the budget as plain text in linear time, with the rest of the page', () => {
    const small = `[Guide](/guide)\n\n<a href="/sample">${'*a* '.repeat(600)}</a>\n\n`.repeat(8);
    const large = small.repeat(4);
    const render = (content: string) => renderToStaticMarkup(<Markdown content={content} />);
    const [smallMs, largeMs] = growthMs(render, small, large);
    expect(largeMs).toBeLessThanOrEqual(linearGrowthLimit(smallMs));
    const html = render(large);
    expect(html.match(/data-markdown-plain/g)).toHaveLength(32);
    expect(html).toContain('&lt;a href=');
    expect(html.match(/href="\/guide"/g)).toHaveLength(32);
  });

  // Round two of the review: the two shapes whose cost grew faster than the page, rendered whole.
  const render = (content: string) => renderToStaticMarkup(<Markdown content={content} />);
  it.each([
    // Lines of emphasis with no blank line between them: one paragraph, over the marker limit.
    ['emphasis over the lines of one paragraph', (lines: number) => `Intro.\n\n${`${'*a'.repeat(1000)}\n`.repeat(lines)}`, 4],
    // Too deep, then closing tags that match nothing open.
    [
      'deep tags, then closing tags that match none',
      (lines: number) => `${'<span>'.repeat(65)}\n${`${'<span></i>'.repeat(100)}\n`.repeat(lines)}`,
      8,
    ],
  ])('renders %s in linear time', (_name, shape, lines) => {
    const [smallMs, largeMs] = growthMs(render, shape(lines), shape(lines * 4));
    expect(largeMs).toBeLessThanOrEqual(linearGrowthLimit(smallMs));
    expect(render(shape(lines))).toContain('data-markdown-plain');
  });

  it.each([
    // Paragraphs at the marker limit, each spread over two lines: within budget, so all of it is parsed.
    ['paragraphs of emphasis at the marker limit', (count: number) => `${'*a'.repeat(500)}\n${'*a'.repeat(500)}\n\n`.repeat(count), 2],
    // A table the editor saves as one line of HTML.
    [
      'a one-line HTML table',
      (count: number) =>
        `<table><tbody>${'<tr><td colspan="1" rowspan="1"><p>Row</p></td><td colspan="1" rowspan="1"><p>Yes</p></td></tr>'.repeat(count * 125)}</tbody></table>`,
      2,
    ],
  ])('renders %s within budget in linear time', (_name, shape, count) => {
    const [smallMs, largeMs] = growthMs(render, shape(count), shape(count * 4));
    expect(largeMs).toBeLessThanOrEqual(linearGrowthLimit(smallMs));
    expect(render(shape(count))).not.toContain('data-markdown-plain');
  });
});
