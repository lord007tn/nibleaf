import { growthMs, growthTestsEnabled, linearGrowthLimit } from '@nibleaf/shared/testing/growth';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Markdown } from './markdown';

describe.runIf(growthTestsEnabled)('reader fallback for over-budget Markdown', () => {
  it('renders the plain source in linear time when it cannot start the Markdown pipeline', () => {
    const small = '<a href="/sample">A link</a> '.repeat(800);
    const large = small.repeat(4);
    const render = (content: string) => renderToStaticMarkup(<Markdown content={content} />);
    const [smallMs, largeMs] = growthMs(render, small, large);
    expect(largeMs).toBeLessThanOrEqual(linearGrowthLimit(smallMs));
    expect(render(large)).toContain('&lt;a href=');
  });
});
