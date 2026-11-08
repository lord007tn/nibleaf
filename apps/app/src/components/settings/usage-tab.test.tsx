// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '@/hooks/api';

const mocks = vi.hoisted(() => ({ usage: vi.fn(), refetch: vi.fn() }));
vi.mock('@nibleaf/i18n/react', () => ({
  useT: () => (key: string, params?: Record<string, string>) => (params ? `${key}:${JSON.stringify(params)}` : key),
}));
vi.mock('@/hooks/api', () => ({ useProjectUsage: mocks.usage }));

import { UsageTab } from './usage-tab';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

describe('UsageTab request recovery', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it('replaces loading placeholders with a retry action after a request fails', async () => {
    mocks.usage.mockReturnValue({ isPending: false, isError: true, refetch: mocks.refetch });
    await act(async () => root.render(<UsageTab project={{ id: 'project-1' } as Project} />));

    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.querySelector('.animate-pulse')).toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>('button')?.click());
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });
});

describe('UsageTab progress semantics', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  const renderMeter = async (quantity: string, ratio: number, state = 'available') => {
    mocks.usage.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        plan: { key: 'free' },
        availability: 'complete',
        period: { start: '2026-11-01T00:00:00.000Z', endExclusive: '2026-12-01T00:00:00.000Z' },
        meters: [{ key: 'published_page', unit: 'count', quantity, limit: '1000', ratio, state, availability: 'complete' }],
      },
    });
    await act(async () => root.render(<UsageTab project={{ id: 'project-1' } as Project} />));
    const bar = container.querySelector<HTMLElement>('[role="progressbar"]');
    const text = bar?.getAttribute('aria-valuetext') ?? '';
    return {
      now: bar?.getAttribute('aria-valuenow'),
      width: bar?.querySelector<HTMLElement>('div')?.style.width,
      text: { key: text.slice(0, text.indexOf(':')), ...JSON.parse(text.slice(text.indexOf(':') + 1)) },
    };
  };

  it.each([
    { quantity: '0', ratio: 0, now: '0', width: '0%', percent: '0%' },
    // A tiny share keeps a visible sliver but is announced as what it is.
    { quantity: '1', ratio: 0.001, now: '0', width: '2%', percent: '0.1%' },
    { quantity: '500', ratio: 0.5, now: '50', width: '50%', percent: '50%' },
    { quantity: '1000', ratio: 1, now: '100', width: '100%', percent: '100%', state: 'exceeded' },
    // Over the limit: the bar and valuenow stop at 100, the text says how far over.
    { quantity: '1200', ratio: 1.2, now: '100', width: '100%', percent: '120%', state: 'exceeded' },
  ])('announces $percent of the limit', async ({ quantity, ratio, now, width, percent, state }) => {
    const meter = await renderMeter(quantity, ratio, state);
    expect(meter.now).toBe(now);
    expect(meter.width).toBe(width);
    expect(meter.text).toEqual({
      key: 'settings.usage.progressValue',
      used: new Intl.NumberFormat('en').format(Number(quantity)),
      limit: '1,000',
      percent,
    });
  });
});
