import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AnalyticsProvider, useAnalyticsFilters } from './analytics-provider';

function RangeProbe() {
  const { range } = useAnalyticsFilters();
  return <span data-range={range} />;
}

describe('AnalyticsProvider', () => {
  it('opens every analytics surface on the last 30 days', () => {
    expect(
      renderToStaticMarkup(
        <AnalyticsProvider>
          <RangeProbe />
        </AnalyticsProvider>,
      ),
    ).toContain('data-range="30d"');
  });
});
