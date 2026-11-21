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
});
