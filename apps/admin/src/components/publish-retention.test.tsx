import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@nibleaf/i18n', () => ({ getLocale: () => 'en' }));
vi.mock('@nibleaf/i18n/react', () => ({
  useLocale: () => ({ locale: 'en' }),
  useT: () => (key: string, variables?: Record<string, string>) => (variables ? `${key}:${Object.values(variables).join()}` : key),
}));

import { PublishRetentionReadout } from './publish-retention';

const computedAt = '2026-10-30T12:00:00.000Z';
const metricValues = (html: string) => [...html.matchAll(/text-2xl[^>]*>([^<]*)</g)].map((match) => match[1]);

describe('publish retention readout', () => {
  it('shows Unknown rather than zero when coverage is missing', () => {
    const html = renderToStaticMarkup(
      <PublishRetentionReadout
        retention={{ firstManualPublishes: null, cohortSize: null, retained: null, rate: null, observationStart: null, computedAt }}
      />,
    );
    expect(metricValues(html)).toEqual(Array.from({ length: 4 }, () => 'admin.overview.retentionUnknown'));
    expect(html).not.toContain('admin.overview.retentionCoverage');
    expect(html).not.toContain('admin.overview.retentionSmallGroup');
    expect(html).toContain('admin.overview.retentionUpdated');
  });

  it('keeps a known zero and explains a rate hidden for a small group', () => {
    const html = renderToStaticMarkup(
      <PublishRetentionReadout
        retention={{ firstManualPublishes: 2, cohortSize: 3, retained: 0, rate: null, observationStart: '2026-09-06T00:00:00.000Z', computedAt }}
      />,
    );
    expect(metricValues(html)).toEqual(['2', '3', '0', 'admin.overview.retentionUnknown']);
    expect(html).toContain('admin.overview.retentionSmallGroup');
    expect(html).toContain('admin.overview.retentionCoverage:Sep');
  });

  it('formats a known rate as a percentage', () => {
    const html = renderToStaticMarkup(
      <PublishRetentionReadout
        retention={{ firstManualPublishes: 8, cohortSize: 5, retained: 2, rate: 0.4, observationStart: '2026-09-06T00:00:00.000Z', computedAt }}
      />,
    );
    expect(metricValues(html)).toEqual(['8', '5', '2', '40%']);
    expect(html).not.toContain('admin.overview.retentionSmallGroup');
  });
});
