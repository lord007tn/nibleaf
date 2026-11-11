// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.mock('@tanstack/react-router', () => ({ Link: () => null }));
vi.mock('@/lib/format', () => ({ useFormatters: () => ({ date: () => 'Nov 1', number: (value: bigint | number) => String(value) }) }));
vi.mock('@/hooks/api', () => ({ useProjectUsage: () => ({}) }));

import { UsageOverview } from './usage-overview';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
let root: ReturnType<typeof createRoot>;
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
});

const usage = {
  period: { start: '2026-11-01T00:00:00.000Z', endExclusive: '2026-12-01T00:00:00.000Z' },
  availability: 'partial' as const,
  meters: [
    { key: 'published_page', unit: 'count', quantity: '6', ratio: null, state: 'unlimited' as const },
    { key: 'build', unit: 'count', quantity: null, ratio: null, state: 'unknown' as const, unavailableReason: 'metering_disabled' },
    { key: 'search_query', unit: 'count', quantity: null, ratio: null, state: 'unknown' as const, unavailableReason: 'metering_disabled' },
  ],
} as never;

const render = async (headingLevel?: 1 | 2) => {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(<UsageOverview description="d" headingLevel={headingLevel} isPending={false} title="Organization usage" usage={usage} />),
  );
  return host;
};
const levels = (host: Element) => [...host.querySelectorAll('h1, h2, h3, h4')].map((heading) => heading.tagName);

describe('UsageOverview headings', () => {
  it('is the page on website Usage: h1, then h2 groups and h3 tiles', async () => {
    const host = await render();
    expect(host.querySelector('h1')?.textContent).toBe('Organization usage');
    expect(new Set(levels(host))).toEqual(new Set(['H1', 'H2', 'H3']));
  });

  // Organizations review of #479: the org page has its own h1.
  it('sits below a page h1 when embedded: h2, then h3 groups and h4 tiles, and no h1', async () => {
    const host = await render(2);
    expect(host.querySelector('h1')).toBeNull();
    expect(host.querySelector('h2')?.textContent).toBe('Organization usage');
    expect(new Set(levels(host))).toEqual(new Set(['H2', 'H3', 'H4']));
  });

  it('says a reason shared by every missing number once, not on each tile', async () => {
    const host = await render();
    expect(host.textContent?.split('settings.usage.reason.meteringDisabled').length).toBe(2);
  });
});
